//
// Hypha: A native client for testing replication of a single hypercore.
//
const hypercore = require('hypercore')
const hyperdb = require('hyperdb')
const ram = require('random-access-memory')
const hyperswarm = require('@hyperswarm/network')
const { pipeline } = require('stream')

const { discoveryKey } = require('hypercore/lib/crypto')

const swarm = hyperswarm()

// Basic argument validation.
if (process.argv.length !== 3) {
  console.log(`Usage: node index.js <read key to replicate>`)
  process.exit()
}

const readKeyInHex = process.argv[2]
console.log(`\nAttempting to find and replicate hyperdb with read key:\n${readKeyInHex}\n`)

const readKeyBuffer = Buffer.from(readKeyInHex, 'hex')
const discoveryKeyBuffer = discoveryKey(readKeyBuffer)
const discoveryKeyInHex = discoveryKeyBuffer.toString('hex')

// Create the local hyperdb instance
// NOTE: But this says do *NOT* pass the read key ???
// See https://github.com/mafintosh/hyperdb/issues/153
const db = hyperdb((filename) => ram(filename), readKeyBuffer, {
  createIfMissing: false,
  overwrite: false,
  valueEncoding: 'json'
})


const watcher = db.watch('/table', () => {
  db.get('/table', (error, values) => {
    // New data is available on the db. Display it on the page.
    const obj = values[0].value
    for (let [key, value] of Object.entries(obj)) {
      console.log(`[Replicate] ${key}: ${value}`)
    }
  })
})

db.on('ready', () => {
  console.log('Local hyperdb ready.')

  //
  // Join the swarm
  //
  swarm.join(discoveryKeyBuffer, {
    lookup: true, // find and connect to peers.
    announce: true // optional: announce self as a connection target.
  })

  swarm.on('connection', (remoteNativeStream, details) => {

    console.log(`Joined swarm for read key ${readKeyInHex}, discovery key ${discoveryKeyInHex}`)

    // Replicate!
    console.log('About to replicate!')

    // Create the local replication stream.
    const localReplicationStream = db.replicate({encrypt: false, live: true})

    pipeline(
      remoteNativeStream,
      localReplicationStream,
      remoteNativeStream,
      (error) => {
        console.log(`Pipe closed for ${readKeyInHex}`, error && error.message)
      }
    )
  })

})
