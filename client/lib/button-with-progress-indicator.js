//
// Component: button with progress indicator.
//

const EventEmitter = require('events').EventEmitter

class ButtonWithProgressIndicator extends EventEmitter {
  constructor (elementId) {
    super()

    // Save references to view items.
    this.element = document.getElementById(elementId)
    this.progressIndicator = this.element.querySelector('.spinner')
    this.innerButton = this.element.querySelector('button')

    // Register for the click event
    this.innerButton.addEventListener('click', (event) => {
      this.emit('click')
    })
  }

  set visible (state) {
    this.element.style.display = state ? 'block' : 'none'
  }

  set label (title) {
    this.innerButton.innerHTML = title
  }

  set enabled (state) {
    this.innerButton.disabled = state ? false : true
  }

  showProgress () {
    this.innerButton.style.display = 'none'
    this.progressIndicator.style.display = 'block'
  }

  hideProgress () {
    this.innerButton.style.display = 'block'
    this.progressIndicator.style.display = 'none'
  }
}

module.exports = ButtonWithProgressIndicator
