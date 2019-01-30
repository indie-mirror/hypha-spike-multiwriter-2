//
// Component: button with progress indicator.
//
class ButtonWithProgressIndicator {
  constructor (elementId) {
    // Save references to view items.
    this.element = document.getElementById(elementId)
    this.innerButton = this.element.querySelector('button')
    this.progressIndicator = this.element.querySelector('.spinner')
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
