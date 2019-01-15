const fs = require('fs')
const https = require('https')
const { pipeline } = require('stream')

const budo = require('budo')
const babelify = require('babelify')

const server = budo('index.js', {
  live: true,
  port: 443,
  ssl: true,
  key: 'localhost-key.pem',
  cert: 'localhost.pem',
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
