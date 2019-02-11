//
// Hypha: A native client for testing replication of a single hypercore.
//
const hypercore = require('hypercore')
const hyperdb = require('hyperdb')
const ram = require('random-access-memory')
const hyperswarm = require('@hyperswarm/network')
const { pipeline } = require('stream')

const { discoveryKey } = require('hypercore/lib/crypto')

const { SecureEphemeralMessagingChannel } = require('@hypha/secure-ephemeral-messaging-channel')

const swarm = hyperswarm()

const crypto = require('crypto')

const readlineSync = require('readline-sync')

// Basic argument validation.
if (process.argv.length !== 4) {
  console.log(`Usage: node index.js <read key> <secure ephemeral messaging channel key (secret)>`)
  process.exit()
}

const readKeyInHex = process.argv[2]
const secureEphemeralMessagingChannelKeyInHex = process.argv[3]
console.log(`\nAttempting to find and replicate hyperdb with:\n  Read key: ${readKeyInHex}\n  Secure ephemeral messaging channel key: ${secureEphemeralMessagingChannelKeyInHex}`)

const secureEphemeralMessagingChannelKey = Buffer.from(secureEphemeralMessagingChannelKeyInHex, 'hex')
const secureEphemeralMessagingChannel = new SecureEphemeralMessagingChannel(secureEphemeralMessagingChannelKey)

const readKeyBuffer = Buffer.from(readKeyInHex, 'hex')
const discoveryKeyBuffer = discoveryKey(readKeyBuffer)
const discoveryKeyInHex = discoveryKeyBuffer.toString('hex')

const ephemeralMessageHashes = {}

function createMessageHash(message) {
  return crypto.createHash('sha256').update(JSON.stringify(message)).digest('hex')
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


// Add this database to the secure ephemeral messaging channel.
secureEphemeralMessagingChannel.addDatabase(db)

secureEphemeralMessagingChannel.on('message', (database, peer, message) => {
  console.log('*** Ephemeral message received. ***')
  console.log(`Peer.feed.key ${peer.feed.key.toString('hex')}, peer.feed.id ${peer.feed.id.toString('hex')} has sent a mesage on database with key and id ${database.key.toString('hex')} ${database.id.toString('hex')}`, message)

  const request = message

  const messageHash = createMessageHash(message)

  console.log('request', request)
  console.log('messageHash', messageHash)

  console.log('ephemeralMessageHashes[messageHash]', ephemeralMessageHashes[messageHash])

  if (ephemeralMessageHashes[messageHash] !== undefined) {
    console.log('Message already seen, ignoring.')
    return
  }

  // Push the message hash into the list of seen messages in case we get it again
  // due to redundant channels of communication.
  ephemeralMessageHashes[messageHash] = true

  // Note (todo): also, we should probably not broadcast this to all nodes but only to known writers.
  if (request.action === 'authorise') {
    // TODO: This is not the correct check as the node may have been authorised. FIX! LEFT OFF HERE. Also same for client.
    if (db.key === db.local.key) {

      if (readlineSync.keyInYN(`Authorise ${request.nodeName}? (y/n)`)) {
        // 'Y' key was pressed.
        console.log(`Authorising request for ${request.nodeName} (local read key: ${request.readKey})`)

        const otherNodeReadKey = Buffer.from(request.readKey, 'hex')

        db.authorize(otherNodeReadKey, (error, authorisation) => {
          if (error) throw error

          console.log(authorisation)
        })
      } else {
        // Not 'Y'
        console.log('Request ignored.');
      }
    } else {
      console.log('Not a writeable node, ignoring authorise request.')
    }
  } else {
    console.log('Unknown request.')
  }

})

secureEphemeralMessagingChannel.on('received-bad-message', (error, database, peer) => {
  console.log('!!! Emphemeral message: received bad message !!!', error, database, peer)
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
      extensions: ['secure-ephemeral']
    })

    pipeline(
      remoteNativeStream,
      localReplicationStream,
      remoteNativeStream,
      (error) => {
        console.log(`Pipe closed for ${readKeyInHex}`, error && error.message)
      }
    )

    // Request write access
    setTimeout(() => {
      console.log('Requesting write access…')
      const message = {
        nodeName: 'Native node',
        timestamp: new Date(),
        action: 'authorise',
        readKey: db.local.key.toString('hex'),
      }

      const messageHash = createMessageHash(message)
      secureEphemeralMessagingChannel.broadcast(db, message)
      ephemeralMessageHashes[messageHash] = true

      console.log(`Broadcast message with hash ${messageHash}`)
    }, 1000)
  })

})
