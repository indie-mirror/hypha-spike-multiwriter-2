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

const { SecureEphemeralMessagingChannel } = require('@hypha/secure-ephemeral-messaging-channel')

// Note: the always-on node is an unprivileged node. It will only relay
// ===== the secure messages to other nodes (to other web nodes via WebSocket
//       and to other native nodes via TCP). It cannot decrypt the messages
//       itself. This is by design as the always-on nodes are designed to be
//       hosted by untrusted third parties.
const secureEphemeralMessagingChannel = new SecureEphemeralMessagingChannel()

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
        extensions: ['secure-ephemeral']
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

    // Add this database to the secure ephemeral messaging channel.
    // Note: this is an unprivileged node; it will act as a relay.
    // It does so automatically, there is no further action required.
    // None of the regular methods for privileged nodes are active on
    // it and it emits no events.
    secureEphemeralMessagingChannel.addDatabase(db)

    // For debugging. Listen for the relay event. This event will most
    // likely be removed later.
    secureEphemeralMessagingChannel.on ('relay', (decodedMessage) => {
      console.log('About to relay secure message', decodedMessage)
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
        extensions: ['secure-ephemeral']
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
          extensions: ['secure-ephemeral']
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
