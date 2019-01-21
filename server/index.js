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
const hypercore = require('hypercore')
const hyperswarm = require('@hyperswarm/network')

const budo = require('budo')
const babelify = require('babelify')

const router = express.Router()

const hypercores = {}

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
  // Setup our web socket server (in addition to Budo’s, which is
  // used for live reload).
  expressWebSocket(router, event.server, {
    perMessageDeflate: false
  })

  // Add web socket routes.
  router.ws('/hypha/:readKey', (webSocket, request) => {

    const readKey = request.params.readKey

    console.log('Got web socket request for ', readKey)

    if (hypercores[readKey] !== undefined) {
      console.log(`Hypercore with read key ${readKey} already exists. Ignoring.`)
      return
    }

    // Create a new hypercore with the passed read key and replicate.
    const newCore = hypercore((filename) => ram(filename), readKey, {
      createIfMissing: false,
      overwrite: false,
      valueEncoding: 'json',
      onwrite: (index, data, peer, next) => {
        // console.log(`Feed: [onWrite] index = ${index}, peer = ${peer}, data:`)
        // console.log(data)
        next()
      }
    })

    newCore.on('ready', () => {
      console.log(`Hypercore ready (${readKey})`)

      const remoteWebStream = websocketStream(webSocket)

      const localReadStream = newCore.createReadStream({live: true})
      localReadStream.on('data', (data) => {
        console.log('[Replicate]', data)
      })

      //
      // Replicate :)
      //
      const localReplicationStream = newCore.replicate({
        encrypt: false,
        live: true
      })

      pipeline(
        remoteWebStream,
        localReplicationStream,
        remoteWebStream,
        (error) => {
          console.log(`Pipe closed for ${readKey}`, error && error.message)
        }
      )

      //
      // Connect to the hyperswarm for this hypercore.
      //
      const swarm = hyperswarm()

      const discoveryKey = newCore.discoveryKey
      const discoveryKeyInHex = discoveryKey.toString('hex')

      console.log(discoveryKeyInHex)

      console.log(`Joining hyperswarm for discovery key ${discoveryKeyInHex}.`)

      // Join the swarm
      swarm.join(newCore.discoveryKey, {
        lookup: true, // find and connect to peers.
        announce: true // optional: announce self as a connection target.
      })

      swarm.on('connection', (remoteNativeStream, details) => {
        console.log(`Got peer for ${readKey} (discovery key: ${discoveryKeyInHex})`)

        // Create a new replication stream
        const nativeReplicationStream = newCore.replicate({
          encrypt: false,
          live: true
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

  // TODO: Join swarm, add cancellation, etc.

  // Display connection info.
  const horizontalRule = new Array(60).fill('⎺').join('')
  console.log('\nHypha Spike: DAT 1')
  console.log(horizontalRule)
  console.log(`Serving: ${event.uri}`)
  console.log(`Working directory: ${event.dir}`)
  console.log(`Entry: ${event.serve}`)
  console.log(horizontalRule)
})
