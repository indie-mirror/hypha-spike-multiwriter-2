//
// Hypha client
//

// Initial key generation
const session25519 = require('session25519')
const generateEFFDicewarePassphrase = require('eff-diceware-passphrase')

// Hypercore
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

// From libsodium.
function to_hex(input) {
  // Disable input checking for this simple spike.
  // input = _any_to_Uint8Array(null, input, "input");
  var str = "",
    b,
    c,
    x;
  for (var i = 0; i < input.length; i++) {
    c = input[i] & 0xf;
    b = input[i] >>> 4;
    x =
      ((87 + c + (((c - 10) >> 8) & ~38)) << 8) |
      (87 + b + (((b - 10) >> 8) & ~38));
    str += String.fromCharCode(x & 0xff) + String.fromCharCode(x >>> 8);
  }
  return str;
}

// HTML elements.
const setupForm = document.getElementById('setupForm')
const buttonAndProgressIndicator = document.getElementById('buttonAndProgressIndicator')
const changeButton = document.getElementById('change')
const passphraseTextField = document.getElementById('passphrase')
const indeterminateProgressIndicator = document.getElementById('indeterminateProgressIndicator')

const generatedTextField = document.getElementById('generated')
const dbContentsTextArea = document.getElementById('hypercoreContents')
const errorsTextArea = document.getElementById('errors')
const publicSigningKeyTextField = document.getElementById('publicSigningKey')
const localKeyTextField = document.getElementById('localKey')
const privateSigningKeyTextArea = document.getElementById('privateSigningKey')
const publicEncryptionKeyTextField = document.getElementById('publicEncryptionKey')
const privateEncryptionKeyTextField = document.getElementById('privateEncryptionKey')

const signals = ['ready', 'change', 'error', 'append', 'download', 'upload', 'sync', 'close']

function setSignalVisible(signal, state) {
  const offState = document.querySelector(`#${signal}Signal > .off`)
  const onState = document.querySelector(`#${signal}Signal > .on`)

  if (state) {
    onState.classList.add('visible')
    offState.classList.add('invisible')
  } else {
    onState.classList.remove('visible')
    offState.classList.remove('invisible')
  }
}

function resetSignals() {
  signals.forEach((signal) => {
    setSignalVisible(signal, false)
  })
}

function blinkSignal(signal) {
  setSignalVisible(signal, true)

  // Keep the ready signal lit throughout. All others, blink.
  if (signal !== 'ready') {
    setTimeout(() => {
      setSignalVisible(signal, false)
    }, 333)
  }
}

function resetForm() {
  passphraseTextField.value = ''
  publicSigningKeyTextField.value = ''
  generatedTextField.value = 'No'
  resetSignals()
  dbContentsTextArea.value = ''
  errorsTextArea.value = ''
  privateSigningKeyTextArea.value = ''
  publicEncryptionKeyTextField.value = ''
  privateEncryptionKeyTextField.value = ''
}

function logError(error) {
  errorsTextArea.value += error
}

function generatePassphrase () {
  resetForm()

  showProgressIndicator()

  // On next tick, so the interface has a chance to update.
  setTimeout(() => {
    const passphrase = generateEFFDicewarePassphrase.entropy(100)
    setupForm.elements.passphrase.value = passphrase.join(' ')
    generateKeys()
  }, 0)
}

function showDetails() {
  detailSections = document.getElementsByClassName('details')
  for (var i = 0; detailSections[i]; i++) {
    detailSections[i].style.display = 'block'
  }
}

function hideDetails() {
  detailSections = document.getElementsByClassName('details')
  for (var i = 0; detailSections[i]; i++) {
    detailSections[i].style.display = 'none'
  }
}

function showProgressIndicator() {
  changeButton.style.display = 'none';
  indeterminateProgressIndicator.style.display = 'block';
}

function hideProgressIndicator() {
  changeButton.style.display = 'block';
  indeterminateProgressIndicator.style.display = 'none';
}

function hideButton () {
  buttonAndProgressIndicator.style.display = 'none'
}

function clearOutputFields() {
  publicSigningKeyTextField.value = ''
  privateSigningKeyTextArea.value = ''
  publicEncryptionKeyTextField.value = ''
  privateEncryptionKeyTextField.value = ''
}

function generateKeys() {
  const passphrase = setupForm.elements.passphrase.value
  const domain = setupForm.elements.domain.value

  session25519(domain, passphrase, (error, keys) => {

    hideProgressIndicator()
    hideButton()
    showDetails()

    if (error) {
      logError(error.message)
      return
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

    const nodeReadKeyInHex = to_hex(keys.publicSignKey)
    const nodeWriteKeyInHex = to_hex(keys.secretSignKey)
    const nodeReadKey = Buffer.from(keys.publicSignKey.buffer)
    const nodeWriteKey = Buffer.from(keys.secretSignKey.buffer)

    // Calculate the discovery key from the read key (the hyphalink).
    const nodeDiscoveryKey = discoveryKey(nodeReadKey)
    const nodeDiscoveryKeyInHex = nodeDiscoveryKey.toString('hex')

    let db = null
    let stream = null
    let updateInterval = null

    console.log(`Creating new hyperdb with read key ${nodeReadKeyInHex} and write key ${nodeWriteKeyInHex}`)

    // Create a new hypercore using the newly-generated key material.
    db = hyperdb((filename) => ram(filename), nodeReadKey, {
      createIfMissing: false,
      overwrite: false,
      valueEncoding: 'json',
      secretKey: nodeWriteKey,
      storeSecretKey: false //,
      // onwrite: (index, data, peer, next) => {
      //   console.log(`db: [onWrite] index = ${index}, peer = ${peer}, data:`)
      //   console.log(data)
      //   // TypeError: next is not a function
      //   // next()
      // }
    })


    db.on('ready', () => {
      const dbKey = db.key
      const dbKeyInHex = to_hex(dbKey)

      console.log(`db: [Ready] ${dbKeyInHex}`)

      blinkSignal('ready')
      generatedTextField.value = 'Yes'

      // Display the local key for the local writer.
      console.log(db.local)
      localKeyTextField.value = db.local.key.toString('hex')

      const watcher = db.watch('/table', () => {
        console.log('Database updated!')
        db.get('/table', (error, values) => {
          console.log(values)

          blinkSignal('change')
          console.log('db [change: get]', values)

          // New data is available on the db. Display it on the page.
          const obj = values[0].value
          for (let [key, value] of Object.entries(obj)) {
            dbContentsTextArea.value += `${key}: ${value}\n`
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
      const webSwarm = swarm(signalhub(nodeDiscoveryKeyInHex, ['https://localhost:444']))
      webSwarm.on('peer', function (remoteWebStream) {

        console.log(`WebSwarm [peer for ${nodeReadKeyInHex} (discovery key: ${nodeDiscoveryKeyInHex})] About to replicate.`)

        // Create the local replication stream.
        const localReplicationStream = db.replicate({
          live: true
        })

        pump(
          remoteWebStream,
          localReplicationStream,
          remoteWebStream,
          (error) => {
            console.log(`[WebRTC] Pipe closed for ${nodeReadKeyInHex}`, error && error.message)
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
            logError(error)
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
      blinkSignal('error')
      logError(error)
    })

    db.on('download', (index, data) => {
      blinkSignal('download')
      console.log(`db [Download] index = ${index}, data = ${data}`)
    })

    db.on('upload', (index, data) => {
      blinkSignal('upload')
      console.log(`db [Upload] index = ${index}, data = ${data}`)
    })

    db.on('append', () => {
      blinkSignal('append')
      console.log('db [Append]')
    })

    db.on('sync', () => {
      blinkSignal('sync')
      console.log('db [Sync]')
    })

    db.on('close', () => {
      blinkSignal('close')
      console.log('db [Close]')
    })

    // Display the keys.
    publicSigningKeyTextField.value = to_hex(keys.publicSignKey)
    privateSigningKeyTextArea.value = to_hex(keys.secretSignKey)
    publicEncryptionKeyTextField.value = to_hex(keys.publicKey)
    privateEncryptionKeyTextField.value = to_hex(keys.secretKey)
  })
}

// Creates passphrase (and keys) when the form is submitted.
function onFormSubmit (event) {

  console.log('((( onFormSubmit )))')

  event.preventDefault()

  if (model.action === kSignUp) {
    generatePassphrase()
  } else {
    alert('Todo: sign in.')
  }
}

const kSignIn = 'Sign in'
const kSignUp = 'Sign up'
model = {
  action: kSignUp
}

function updateInitialState() {
  model.action = (passphraseTextField.value === '') ? kSignUp : kSignIn
  changeButton.innerHTML = model.action
}

// Main
document.addEventListener('DOMContentLoaded', () => {

  console.log('((( DOMContentLoaded )))')

  // Generate the initial node name as <platform> on <os>
  const nodeName = `${platform.name} on ${platform.os}`
  const nodeNameTextField = document.getElementById('nodeName')
  nodeNameTextField.value = nodeName

  // Hide the progress indicators
  hideProgressIndicator()

  resetForm()
  setupForm.addEventListener('submit', onFormSubmit)

  passphraseTextField.addEventListener('keyup', updateInitialState)

})
