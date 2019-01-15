const fs = require('fs')
const https = require('https')
const { pipeline } = require('stream')

const budo = require('budo')
const babelify = require('babelify')

const server = budo('client/index.js', {
  live: true,
  port: 443,
  ssl: true,
  dir: 'client/static/',              // Static content directory
  key: 'server/localhost-key.pem',
  cert: 'server/localhost.pem',
  serve: 'bundle.js',
  stream: process.stdout,             // Log to console
  browserify: {
    transform: babelify
  }
})

server.on('connect', (event) => {
  const horizontalRule = new Array(60).fill('⎺').join('')
  console.log('\nHypha Spike: DAT 1')
  console.log(horizontalRule)
  console.log(`Serving: ${event.uri}`)
  console.log(`Working directory: ${event.dir}`)
  console.log(`Entry: ${event.serve}`)
  console.log(horizontalRule)
})
