//
// View
//

const EventEmitter = require('events').EventEmitter
const ButtonWithProgressIndicator = require('./lib/button-with-progress-indicator')

// For client-side Diceware validation
// (when person is signing in and enters their password manually)
// Wrap it in starting and ending spaces as we search for word using
// indexOf surrounded by spaces: ' word '.
const effDicewareWords = ` ${require('eff-diceware-passphrase/wordlist.json').join(' ')} `


//
// viewModel
//

const kSignIn = 'Sign in'
const kSignUp = 'Sign up'
const viewModel = {
  action: kSignUp
}

// HTML elements.
const setupForm = document.getElementById('setupForm')
const nodeNameTextField = document.getElementById('nodeName')
const accessButton = new ButtonWithProgressIndicator('accessButton')
const authoriseButton = new ButtonWithProgressIndicator('authoriseButton')

const passphraseTextField = document.getElementById('passphrase')
const indeterminateProgressIndicator = document.getElementById('indeterminateProgressIndicator')

const generatedTextField = document.getElementById('generated')
const dbContentsTextArea = document.getElementById('hypercoreContents')
const errorsTextArea = document.getElementById('errors')
const publicSigningKeyTextField = document.getElementById('publicSigningKey')
const localReadKeyTextField = document.getElementById('localReadKey')
const localWriteKeyTextField = document.getElementById('localWriteKey')
const privateSigningKeyTextArea = document.getElementById('privateSigningKey')
const publicEncryptionKeyTextField = document.getElementById('publicEncryptionKey')
const privateEncryptionKeyTextField = document.getElementById('privateEncryptionKey')

const signals = ['ready', 'change', 'error', 'append', 'download', 'upload', 'sync', 'close']


class View extends EventEmitter {

  constructor (model) {
    super()

    this.model = model

    document.addEventListener('DOMContentLoaded', () => {
      this.resetForm()

      passphraseTextField.addEventListener('keyup', this.validatePassphrase)

      // Handle sign up or sign in button.
      accessButton.on('click', event => {
        if (viewModel.action === kSignUp) {
          this.emit('signUp')
        } else {
          this.emit('signIn', passphraseTextField.value)
        }
      })

      this.emit('ready')
    })
  }


  set nodeName (name) {
    nodeNameTextField.value = name
  }

  get domain () {
    return setupForm.elements.domain.value
  }

  validatePassphrase () {
    const passphrase = passphraseTextField.value
    viewModel.action = (passphrase === '') ? kSignUp : kSignIn
    accessButton.label = viewModel.action

    if (viewModel.action === kSignIn) {
      // Validate that the passphrase exists solely of diceware words
      // and has at least eight words (as we know the password generation aims
      // for at least 100 bits of entropy. Seven words has ~90 bits.)
      const words = passphrase.trim().split(' ')
      const numWords = words.length
      const entropyIsHighEnough = numWords >= 8

      let allWordsInWordList = true
      for (let i = 0; i < numWords; i++) {
        const word = ` ${words[i]} `
        if (effDicewareWords.indexOf(word) === -1) {
          allWordsInWordList = false
          break
        }
      }

      // if (!entropyIsHighEnough) { console.log ('entropy is not high enough') }
      // if (!allWordsInWordList) { console.log ('Non-diceware words entered') }
      // if (entropyIsHighEnough && allWordsInWordList) { console.log ('Passphrase valid') }

      accessButton.enabled = (entropyIsHighEnough && allWordsInWordList)
    } else {
      accessButton.enabled = true
    }
  }

  addContent (content) {
    dbContentsTextArea.value += content
  }

  showPassphrase () {
    setupForm.elements.passphrase.value = this.model.passphrase
  }

  showAccessProgress () {
    accessButton.showProgress()
  }


  hideAccessProgress () {
    accessButton.hideProgress()
  }


  showDatabaseIsReady () {
    this.displayKeys()
    this.blinkSignal('ready')
    generatedTextField.value = 'Yes'
  }


  setSignalVisible(signal, state) {
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


  resetSignals() {
    signals.forEach((signal) => {
      this.setSignalVisible(signal, false)
    })
  }


  blinkSignal(signal) {
    this.setSignalVisible(signal, true)

    // Keep the ready signal lit throughout. All others, blink.
    if (signal !== 'ready') {
      setTimeout(() => {
        this.setSignalVisible(signal, false)
      }, 333)
    }
  }


  resetForm() {
    passphraseTextField.value = ''
    publicSigningKeyTextField.value = ''
    generatedTextField.value = 'No'
    this.resetSignals()
    dbContentsTextArea.value = ''
    errorsTextArea.value = ''
    privateSigningKeyTextArea.value = ''
    publicEncryptionKeyTextField.value = ''
    privateEncryptionKeyTextField.value = ''
  }


  logError(error) {
    errorsTextArea.value += error
  }


  showDetails() {
    const detailSections = document.getElementsByClassName('details')
    for (var i = 0; detailSections[i]; i++) {
      detailSections[i].style.display = 'block'
    }

    accessButton.visible = false

    this.displayKeys()
  }


  hideDetails() {
    const detailSections = document.getElementsByClassName('details')
    for (var i = 0; detailSections[i]; i++) {
      detailSections[i].style.display = 'none'
    }

    accessButton.visible = true
  }


  displayKeys() {
    publicSigningKeyTextField.value = this.model.keys.nodeReadKeyInHex
    privateSigningKeyTextArea.value = this.model.keys.nodeWriteKeyInHex
    publicEncryptionKeyTextField.value = this.model.keys.publicEncryptionKeyInHex
    privateEncryptionKeyTextField.value = this.model.keys.privateEncryptionKeyInHex
    localReadKeyTextField.value = this.model.keys.localReadKeyInHex
    localWriteKeyTextField.value = this.model.keys.localWriteKeyInHex
  }


  clearOutputFields() {
    publicSigningKeyTextField.value = ''
    privateSigningKeyTextArea.value = ''
    publicEncryptionKeyTextField.value = ''
    privateEncryptionKeyTextField.value = ''
    localReadKeyTextField.value = ''
    localWriteKeyTextField.value = ''
  }
}

module.exports = View
