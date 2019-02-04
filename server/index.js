//
// Hypha server.
//
const fs = require('fs')
const https = require('https')
const { pipeline } = require('stream')

const express = require('express')
const expressWebSocket = require('express-ws')
const websocketStream = require('websocket-stream/stream')
const ram  = require('random-access-memory')
const hyperdb = require('hyperdb')
const hyperswarm = require('@hyperswarm/network')

const signalHubServer = require('signalhub/server')

const budo = require('budo')
const babelify = require('babelify')

const router = express.Router()

const hyperdbs = {}

const { DatEphemeralExtMsg: DatEphemeralMessageExtension } = require('@beaker/dat-ephemeral-ext-msg')
const ephemeralMessagingChannel = new DatEphemeralMessageExtension()

// Create secure signalhub server.
const signalHub = signalHubServer({
  key: fs.readFileSync('server/localhost-key.pem'),
  cert: fs.readFileSync('server/localhost.pem')
})

signalHub.on('subscribe', channel => {
  console.log('[Signal Hub] Subscribe: ', channel)
})

signalHub.on('broadcast', (channel, message) => {
  console.log('[Signal Hub] Broadcast: ', channel, message.length)
})

signalHub.listen(444, 'localhost', () => {
  console.log(`[Signal Hub] Listening on port ${signalHub.address().port}.`)
})

// Create secure development web server via budo.
const server = budo('client/index.js', {
  live: false,
  port: 443,
  ssl: true,
  dir: 'client/static/',              // Static content directory
  key: 'server/localhost-key.pem',
  cert: 'server/localhost.pem',
  serve: 'bundle.js',
  stream: process.stdout,             // Log to console
  browserify: {
    transform: babelify
  },
  middleware: [
    router
  ]
})

server.on('connect', (event) => {
  console.log('Setting up web socket server.')
  expressWebSocket(router, event.server, {
    perMessageDeflate: false
  })

  // Add web socket routes.
  router.ws('/hypha/:readKey', (webSocket, request) => {

    const readKey = request.params.readKey

    console.log('Got web socket request for ', readKey)

    if (hyperdbs[readKey] !== undefined) {
      console.log(`Hyperdb with read key ${readKey} already exists. About to replicate.`)

      const db = hyperdbs[readKey]

      // Replicate.
      // TODO: Refactor to remove redundancy.
      const remoteWebStream = websocketStream(webSocket)
      const localReplicationStream = db.replicate({
        encrypt: false,
        live: true,
        extensions: ['ephemeral']
      })

      // console.log('remoteWebStream', remoteWebStream)
      // console.log('localReplicationStream', localReplicationStream)

      pipeline(
        remoteWebStream,
        localReplicationStream,
        remoteWebStream,
        (error) => {
          console.log(`[Non origin web socket] Pipe closed for ${readKey}`, error && error.message)
        }
      )

      return
    }

    // Create a new hyperdb with the passed read key and replicate.
    const db = hyperdb((filename) => ram(filename), readKey, {
      createIfMissing: false,
      overwrite: false,
      valueEncoding: 'json'
    })

    // Add to list of existing hyperdbs.
    hyperdbs[readKey] = db

    // Join the ephemeral messaging channel on this database.
    // Watch the database for ephemeral messages.
    ephemeralMessagingChannel.watchDat(db)

    ephemeralMessagingChannel.on('message', (database, peer, {contentType, payload}) => {

      // TODO: Once the ephemeral messaging channel is encrypted, all we
      // will be doing on the always-on node is to relay received messages to the
      // native nodes and ditto from native notes to web nodes.

      console.log('*** Ephemeral message received. ***')
      console.log(`Peer.feed.key ${peer.feed.key.toString('hex')}, peer.feed.id ${peer.feed.id.toString('hex')} has sent payload >${payload}< of content type ${contentType} on database with key and id ${database.key.toString('hex')} ${database.id.toString('hex')}`)

      // This is a proof of concept. This will be encrypted in the future.
      const request = JSON.parse(payload.toString('utf8'))

      console.log('request', request)

      console.log('Relaying request to web nodes via WebSocket and to native nodes via TCP.')

      // Relay the message back to the database (so that it is sent to other web nodes
      // via WebSocket and other native nodes over TCP).
      ephemeralMessagingChannel.broadcast(db, {contentType, payload})

      // console.log('TODO: relay request to native nodes.')

      // Note (todo): also, we should probably not broadcast this to all nodes but only to known writers.
      // if (request.action === 'authorise') {
      //   if (db.key === db.local.key) {
      //     model.lastRequest = request
      //     view.showAuthorisationRequest(request.nodeName)
      //   } else {
      //     console.log('Not a writeable node, ignoring authorise request.')
      //   }
      // } else {
      //   console.log('Unknown request.')
      // }

    })

    ephemeralMessagingChannel.on('received-bad-message', (error, database, peer, messageBuffer) => {
      console.log('!!! Emphemeral message: received bad message !!!')
      console.log(`Peer.feed.key: ${peer.feed.key.toString('hex')}, peer.feed.id ${peer.feed.id.toString('hex')}, database: ${database}, message buffer: ${messageBuffer}`, error)
    })

    db.on('ready', () => {
      console.log(`Hyperdb ready (${readKey})`)

      const remoteWebStream = websocketStream(webSocket)

      const watcher = db.watch('/table', () => {
        db.get('/table', (error, values) => {
          // New data is available on the db. Log it to the console.
          const obj = values[0].value
          for (let [key, value] of Object.entries(obj)) {
            console.log(`[Replicate] ${key}: ${value}`)
          }
        })
      })

      //
      // Replicate :)
      //
      const localReplicationStream = db.replicate({
        encrypt: false,
        live: true,
        extensions: ['ephemeral']
      })

      pipeline(
        remoteWebStream,
        localReplicationStream,
        remoteWebStream,
        (error) => {
          console.log(`[Origin] Pipe closed for ${readKey}`, error && error.message)
        }
      )

      //
      // Connect to the hyperswarm for this hyperdb.
      //
      const nativePeers = {}

      const swarm = hyperswarm()

      const discoveryKey = db.discoveryKey
      const discoveryKeyInHex = discoveryKey.toString('hex')

      console.log(`Joining hyperswarm for discovery key ${discoveryKeyInHex}`)

      // Join the swarm
      swarm.join(discoveryKey, {
        lookup: true, // find and connect to peers.
        announce: true // optional: announce self as a connection target.
      })

      swarm.on('connection', (remoteNativeStream, details) => {
        console.log(`Got peer for ${readKey} (discovery key: ${discoveryKeyInHex})`)

        console.log('About to replicate!')

        // Create a new replication stream
        const nativeReplicationStream = db.replicate({
          encrypt: false,
          live: true,
          extensions: ['ephemeral']
        })

        // Replicate!
        pipeline(
          remoteNativeStream,
          nativeReplicationStream,
          remoteNativeStream,
          (error) => {
            console.log(`(Native stream from swarm) Pipe closed for ${readKey}`, error && error.message)
          }
        )

      })
    })
  })

  // Display connection info.
  const horizontalRule = new Array(60).fill('⎺').join('')
  console.log('\nHypha Spike: Multiwriter 2')
  console.log(horizontalRule)
  console.log(`Serving: ${event.uri}`)
  console.log(`Working directory: ${event.dir}`)
  console.log(`Entry: ${event.serve}`)
  console.log(horizontalRule)
})
