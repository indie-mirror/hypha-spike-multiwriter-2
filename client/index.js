//
// Hypha node
//

// Initial key generation
const session25519 = require('session25519')
const generateEFFDicewarePassphrase = require('eff-diceware-passphrase')

// Database
const { Buffer } = require('buffer')
const ram = require('random-access-memory')
const hypercore = require('hypercore')
const hyperdb = require('hyperdb')

// Streams (equivalent of pipeline in Node).
const pump = require('pump')

// Web socket replication
const webSocketStream = require('websocket-stream')

// WebRTC replication
const signalhub = require('signalhub')
const { discoveryKey } = require('hypercore/lib/crypto')
const swarm = require('webrtc-swarm')

const nextId = require('monotonic-timestamp-base36')

const platform = require('platform')

// App-specific
const { to_hex } = require('./lib/helpers')
const View = require('./view')

const model = require('./model')
const view = new View(model)


// Initialise the local node. Either with a new or existing domain.
async function initialiseNode(passphrase = null) {

  view.showAccessProgress()

  if (passphrase === null) {
    await createDomain()
  } else {
    await joinExistingDomain(passphrase)
  }

  view.hideAccessProgress()
}


// Create a new domain and a local node for it.
async function createDomain() {
  console.log('Initialising new node with new domain')

  model.passphrase = await generatePassphrase()

  view.showPassphrase()

  const domain = view.domain

  try {
    model.keys = await generateKeys(model.passphrase, domain)
  } catch (error) {
    console.log('Error: could not generate keys', error)
    view.hideAccessProgress()
    throw(error)
  }

  // This is the origin node; pass in the write key also.
  createDatabase(model.keys.nodeReadKey, model.keys.nodeWriteKey)

  view.showDetails()
}


// Create a local database and authorise it with the primary
// database for an existing domain.
async function joinExistingDomain(passphrase) {
  //
  // A passphrase has been passed. Replicate an existing domain’s database.
  //
  console.log('Initialising new node with existing domain')

  const domain = setupForm.elements.domain.value
  const nodeName = setupForm.elements.nodeName.value

  try {
    const originalKeys = await generateKeys(passphrase, domain)

    console.log('Original keys', originalKeys)

    const nodeKeys = await generateDerivativeKeys(originalKeys.nodeReadKeyInHex, nodeName)
    model.keys = nodeKeys

    console.log ('===')
    console.log ('TO-DO')
    console.log (`Sign into domain ${domain} with global read key ${originalKeys.nodeReadKeyInHex} and global write key ${originalKeys.nodeWriteKeyInHex}`)
    console.log (`Local read key: ${model.keys.nodeReadKeyInHex}. Local write key: ${model.keys.nodeWriteKeyInHex}`)
    console.log ('===')

    // We will eventually be generating the local writer based on reproducible keys
    // but that requires extending hyperdb. Instead, to get multiwriter working, we
    // are letting hyperdb generate the local writer.

    // TODO: Pass in global read key, local read key, and local write key
    // ===== to create a local database based on the origin node.
    originalKeys.nodeWriteKey = null
    originalKeys.nodeWriteKeyInHex = null
    model.keys = originalKeys
    console.log(`About to create database with read key: ${originalKeys.nodeReadKeyInHex}`)
    createDatabase(originalKeys.nodeReadKey)
    view.showDetails()

  } catch (error) {
    console.log('Error: could not generate keys at sign in', error)
    view.hideAccessProgress()
    throw(error)
  }
}


// Returns a promise that resolves to a passphrase.
function generatePassphrase () {
  return new Promise (resolve => {
    // On next tick, so the interface has a chance to update.
    setTimeout(() => {
      const passphrase = generateEFFDicewarePassphrase.entropy(100).join (' ')
      resolve(passphrase)
    }, 0)
  })
}


// Generates derivative key material for a passed read key
// (Ed25519 public signing key) using the nodeId (the reproducible
// node identifier based on the properties of the node – currently
// the platform and client identifiers).
async function generateDerivativeKeys(readKey, nodeId) {
  return generateKeys(readKey, nodeId)
}


// Returns a promise that generates Ed25519 signing keys and
// Curve25519 encryption keys by deriving them from the passed
// passphrase and using the domain as the salt.
function generateKeys(passphrase, domain) {
  return new Promise((resolve, reject) => {

    session25519(domain, passphrase, (error, keys) => {

      if (error) {
        view.logError(error.message)
        reject(error)
      }

      //
      // Convert the keys first to ArrayBuffer and then to
      // Node’s implementation of Buffer, which is what
      // hypercore expected.
      //
      // If you try to pass an ArrayBuffer instead, you get
      // the following error:
      //
      // Error: key must be at least 16, was given undefined
      //
      const nodeReadKey = Buffer.from(keys.publicSignKey.buffer)
      const nodeDiscoveryKey = discoveryKey(nodeReadKey)
      const nodeDiscoveryKeyInHex = nodeDiscoveryKey.toString('hex')

      // TODO: Iterate on terminology. This routine is now used to
      // generate keys for the origin node as well as writer nodes.
      const nodeKeys = {
        nodeReadKey,
        nodeDiscoveryKey,
        nodeDiscoveryKeyInHex,
        nodeReadKeyInHex: to_hex(keys.publicSignKey),
        nodeWriteKeyInHex: to_hex(keys.secretSignKey),
        nodeWriteKey: Buffer.from(keys.secretSignKey.buffer),
        publicEncryptionKeyInHex: to_hex(keys.publicKey),
        privateEncryptionKeyInHex: to_hex(keys.secretKey)
      }

      resolve(nodeKeys)
    })
  })
}


// TODO: Make this accept the global read key, global secret key, and local read key, and local write key as parameters.
// ===== If the global secret key is not passed in and the local read and write keys are, then we create a writer based
//       on an existing database (using its global read key).
//
// TODO: Update hyperDB so that we can pass in the local key and local secret key to the local writer.
// ===== Matthias suggested we do this using a factory function passed into the constructor.
function createDatabase(readKey, writeKey = null) {
  let db = null
  let stream = null
  let updateInterval = null

  console.log(`Creating new hyperdb with read key ${to_hex(readKey)} and write key ${to_hex(writeKey)}`)
  console.log(`This node ${(writeKey === null) ? 'is not': 'is'} an origin node.`)

  // Create a new hypercore using the newly-generated key material.
  db = hyperdb((filename) => ram(filename), readKey, {
    createIfMissing: false,
    overwrite: false,
    valueEncoding: 'json',
    secretKey: writeKey,
    storeSecretKey: false
    // Note: do not define onWrite(). Leads to errors.
  })


  db.on('ready', () => {
    const dbKey = db.key
    const dbKeyInHex = to_hex(dbKey)

    console.log(`db: [Ready] ${dbKeyInHex}`)

    // Update the model with the actual key material from the database.
    model.keys.nodeReadKey = db.key
    model.keys.nodeReadKeyInHex = to_hex(db.key)
    model.keys.nodeWriteKey = db.secretKey
    model.keys.nodeWriteKeyInHex = to_hex(db.secretKey)
    model.keys.localReadKeyInHex = db.local.key.toString('hex')
    model.keys.localWriteKeyInHex = db.local.secretKey.toString('hex')

    view.showDatabaseIsReady()

    // Display the local key for the local writer.
    console.log(db.local)

    const watcher = db.watch('/table', () => {
      console.log('Database updated!')
      db.get('/table', (error, values) => {
        console.log(values)

        view.blinkSignal('change')
        console.log('db [change: get]', values)

        // New data is available on the db. Display it on the view.
        const obj = values[0].value
        for (let [key, value] of Object.entries(obj)) {
          view.addContent(`${key}: ${value}\n`)
        }
      })
    })


    // Hypercore db is ready: connect to web socket and start replicating.
    const remoteStream = webSocketStream(`wss://localhost/hypha/${dbKeyInHex}`)

    const localStream = db.replicate({
      // If we remove the encrypt: false, we get an error on the server:
      // Pipe closed for c4a99bc919c23d9c12b1fe440a41488141263e59fb98288388b578e105ad2523 Remote message is larger than 8MB (max allowed)
      // Why is this and what’s the encryption that we’re turning off here and what effects does this have on privacy and security? (TODO: file issue)
      encrypt: false,
      live: true
    })

    // Create a duplex stream.
    //
    // What’s actually happening:
    //
    // remoteStream.write -> localStream.read
    // localStream.write -> remoteStream.read
    pump(
      remoteStream,
      localStream,
      remoteStream,
      (error) => {
        console.log(`Pipe closed for ${dbKeyInHex}`, error && error.message)
        logError(error.message)
      }
    )

    // Also join a WebRTC swarm so that we can peer-to-peer replicate
    // this hypercore (browser to browser).
    const webSwarm = swarm(signalhub(model.keys.nodeDiscoveryKeyInHex, ['https://localhost:444']))
    webSwarm.on('peer', function (remoteWebStream) {

      console.log(`WebSwarm [peer for ${model.keys.nodeReadKeyInHex} (discovery key: ${model.keys.nodeDiscoveryKeyInHex})] About to replicate.`)

      // Create the local replication stream.
      const localReplicationStream = db.replicate({
        live: true
      })

      pump(
        remoteWebStream,
        localReplicationStream,
        remoteWebStream,
        (error) => {
          console.log(`[WebRTC] Pipe closed for ${model.keys.nodeReadKeyInHex}`, error && error.message)
        }
      )
    })

    //
    // TEST
    //
    const NUMBER_TO_APPEND = 3
    let counter = 0

    const intervalToUpdateInMS = 500
    updateInterval = setInterval(() => {
      counter++
      if (counter === NUMBER_TO_APPEND) {
        console.log(`Reached max number of items to append (${NUMBER_TO_APPEND}). Will not add any more.`)
        clearInterval(updateInterval)
        updateInterval = null
      }

      const key = nextId()
      const value = Math.random()*1000000000000000000 // simple random number
      let obj = {}
      obj[key] = value
      db.put('/table', obj, (error, o) => {
        console.log('Put callback')
        if (error) {
          view.logError(error)
          return
        }
        console.log('  Feed', o.feed)
        console.log('  Sequence:', o.seq)
        console.log('  Key:', o.key)
        console.log('  Value:', o.value)
      })
    }, intervalToUpdateInMS)
  })

  db.on('error', (error) => {
    console.log(`db [Error] ${error}`)
    view.blinkSignal('error')
    view.logError(error)
  })

  db.on('download', (index, data) => {
    view.blinkSignal('download')
    console.log(`db [Download] index = ${index}, data = ${data}`)
  })

  db.on('upload', (index, data) => {
    view.blinkSignal('upload')
    console.log(`db [Upload] index = ${index}, data = ${data}`)
  })

  db.on('append', () => {
    view.blinkSignal('append')
    console.log('db [Append]')
  })

  db.on('sync', () => {
    view.blinkSignal('sync')
    console.log('db [Sync]')
  })

  db.on('close', () => {
    view.blinkSignal('close')
    console.log('db [Close]')
  })

}


// Main

view.on('ready', () => {
  // Generate the initial node name as <platform> on <os>
  view.nodeName = `${platform.name} on ${platform.os}`
})

view.on('signUp', () => {
  initialiseNode()
})

view.on('signIn', (passphrase) => {
  initialiseNode(passphrase)
})
