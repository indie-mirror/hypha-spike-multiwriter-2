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

// Web socket / replication
const webSocketStream = require('websocket-stream')
const pump = require('pump')

const nextId = require('monotonic-timestamp-base36')

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
const changeButton = document.getElementById('change')
const passphraseTextField = document.getElementById('passphrase')
const indeterminateProgressIndicator = document.getElementById('indeterminateProgressIndicator')
const generatedTextField = document.getElementById('generated')
const hypercoreContentsTextArea = document.getElementById('hypercoreContents')
const errorsTextArea = document.getElementById('errors')
const publicSigningKeyTextField = document.getElementById('publicSigningKey')
const privateSigningKeyTextArea = document.getElementById('privateSigningKey')
const publicEncryptionKeyTextField = document.getElementById('publicEncryptionKey')
const privateEncryptionKeyTextField = document.getElementById('privateEncryptionKey')

const signals = ['ready', 'data', 'error', 'append', 'download', 'upload', 'sync', 'close']

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
  hypercoreContentsTextArea.value = ''
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

function showProgressIndicator() {
  changeButton.style.display = 'none';
  indeterminateProgressIndicator.style.display = 'block';
}

function hideProgressIndicator() {
  changeButton.style.display = 'block';
  indeterminateProgressIndicator.style.display = 'none';
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

    console.log(`Creating new hypercore with read key ${to_hex(keys.publicSignKey)} and write key ${to_hex(keys.secretSignKey)}`)

    const hypercoreReadKey = Buffer.from(keys.publicSignKey.buffer)
    const hypercoreWriteKey = Buffer.from(keys.secretSignKey.buffer)

    let feed = null
    let stream = null
    let updateInterval = null

    // Create a new hypercore using the newly-generated key material.
    feed = hypercore((filename) => ram(filename), hypercoreReadKey, {
      createIfMissing: false,
      overwrite: false,
      valueEncoding: 'json',
      secretKey: hypercoreWriteKey,
      storeSecretKey: false,
      onwrite: (index, data, peer, next) => {
        console.log(`Feed: [onWrite] index = ${index}, peer = ${peer}, data:`)
        console.log(data)
        next()
      }
    })


    feed.on('ready', () => {
      const feedKey = feed.key
      const feedKeyInHex = to_hex(feedKey)

      console.log(`Feed: [Ready] ${feedKeyInHex}`)

      blinkSignal('ready')
      generatedTextField.value = 'Yes'

      if (!feed.writable) {
        generatedTextField.value = 'Yes (warning: but feed is not writable)'
        return
      }

      // Hypercore feed is ready: connect to web socket and start replicating.
      const remoteStream = webSocketStream(`wss://localhost/hypha/${feedKeyInHex}`)

      const localStream = feed.replicate({
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
          console.log(`Pipe closed for ${feedKeyInHex}`, error && error.message)
          logError(error.message)
        }
      )

      //
      // Note: the order of execution for an append appears to be:
      //
      // 1. onWrite handler (execution stops unless next() is called)
      // 2. feed’s on('append') handler
      // 3. feed.append callback function
      // 4. readStream’s on('data') handler
      //

      // Create a read stream
      stream = feed.createReadStream({live:true})
      stream.on('data', (data) => {

        blinkSignal('data')
        console.log('Feed [read stream, on data]' , data)

        // New data is available on the feed. Display it on the page.
        for (let [key, value] of Object.entries(data)) {
          hypercoreContentsTextArea.value += `${key}: ${value}\n`
        }
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
        feed.append(obj, (error, sequence) => {
          console.log('Append callback')
          if (error) {
            logError(error)
            return
          }
          console.log('  Sequence', sequence)
        })
      }, intervalToUpdateInMS)
    })

    feed.on('error', (error) => {
      console.log(`Feed [Error] ${error}`)
      blinkSignal('error')
      logError(error)
    })

    feed.on('download', (index, data) => {
      blinkSignal('download')
      console.log(`Feed [Download] index = ${index}, data = ${data}`)
    })

    feed.on('upload', (index, data) => {
      blinkSignal('upload')
      console.log(`Feed [Upload] index = ${index}, data = ${data}`)
    })

    feed.on('append', () => {
      blinkSignal('append')
      console.log('Feed [Append]')
    })

    feed.on('sync', () => {
      blinkSignal('sync')
      console.log('Feed [Sync]')
    })

    feed.on('close', () => {
      blinkSignal('close')
      console.log('Feed [Close]')
    })

    // Update the passphrase (and keys) when the change button is pressed.
    function onChangeButtonPress (event) {

      console.log('((( onChangeButtonPress )))')

      // Let’s remove ourselves as a listener as we will be
      // re-added on the next refresh.
      setupForm.removeEventListener('submit', onChangeButtonPress)

      if (updateInterval !== null) {
        clearInterval(updateInterval)
        updateInterval = null
      }

      if (stream !== null) {
        stream.destroy()
        stream = null
      }

      // If a feed exists, close it and then generate the new keys/feed.
      if (feed !== null) {
        feed.close((error) => {
          console.log(">>> Feed is closed. <<<")
          feed = null
          // Feed is closed. Error is not really an error.
          generatePassphrase()
        })
        event.preventDefault()
        return
      }

      // Otherwise, just go ahead and generate the keys now.
      generatePassphrase()
      event.preventDefault()
    }
    setupForm.addEventListener('submit', onChangeButtonPress)

    // Display the keys.
    publicSigningKeyTextField.value = to_hex(keys.publicSignKey)
    privateSigningKeyTextArea.value = to_hex(keys.secretSignKey)
    publicEncryptionKeyTextField.value = to_hex(keys.publicKey)
    privateEncryptionKeyTextField.value = to_hex(keys.secretKey)
  })
}

// Main
document.addEventListener('DOMContentLoaded', () => {

  console.log('((( DOMContentLoaded )))')

  // Hide the progress indicator
  hideProgressIndicator()

  // Generate a passphrase at start
  generatePassphrase()
})
