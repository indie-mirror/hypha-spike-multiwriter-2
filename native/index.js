//
// Hypha: A native client for testing replication of a single hypercore.
//
const hypercore = require('hypercore')
const hyperdb = require('hyperdb')
const ram = require('random-access-memory')
const hyperswarm = require('@hyperswarm/network')
const { pipeline } = require('stream')

const { discoveryKey } = require('hypercore/lib/crypto')

const { DatEphemeralExtMsg: DatEphemeralMessageExtension } = require('@beaker/dat-ephemeral-ext-msg')
const ephemeralMessagingChannel = new DatEphemeralMessageExtension()

const swarm = hyperswarm()

const crypto = require('crypto')

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

const ephemeralMessageHashes = {}

function createMessageHash(payload) {
  return crypto.createHash('sha256').update(payload.toString('utf8')).digest('hex')
}

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

  const messageHash = createMessageHash(payload)
  console.log('messageHash', messageHash)

  if (ephemeralMessageHashes[messageHash] !== undefined) {
    console.log('Message already seen, ignoring.')
    return
  }

  // Push the message hash into the list of seen messages in case we get it again
  // due to redundant channels of communication.
  ephemeralMessageHashes[messageHash] = true

  console.log('New message', request)
})

ephemeralMessagingChannel.on('received-bad-message', (error, database, peer, messageBuffer) => {
  console.log('!!! Emphemeral message: received bad message !!!')
  console.log(`Peer.feed.key: ${peer.feed.key.toString('hex')}, peer.feed.id ${peer.feed.id.toString('hex')}, database: ${database}, message buffer: ${messageBuffer}`, error)
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
    const localReplicationStream = db.replicate({
      encrypt: false,
      live: true,
      extensions: ['ephemeral']
    })

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
