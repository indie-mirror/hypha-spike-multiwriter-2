const session25519 = require('session25519')
const diceware = require('eff-diceware-passphrase')

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

// Main
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('password').focus()

  document.getElementById('passwordForm').addEventListener('submit', (event) => {
    const form = event.target
    const password = form.elements.password.value
    const domain = form.elements.domain.value

    const publicSigningKeyTextField = document.getElementById('publicSigningKey')
    const privateSigningKeyTextArea = document.getElementById('privateSigningKey')
    const publicEncryptionKeyTextField = document.getElementById('publicEncryptionKey')
    const privateEncryptionKeyTextField = document.getElementById('privateEncryptionKey')

    session25519(domain, password, (error, keys) => {
      if (error) { alert(error); return }

      publicSigningKeyTextField.value = to_hex(keys.publicSignKey)
      privateSigningKeyTextArea.value = to_hex(keys.secretSignKey)
      publicEncryptionKeyTextField.value = to_hex(keys.publicKey)
      privateEncryptionKeyTextField.value = to_hex(keys.secretKey)
    })

    event.preventDefault()
  })
})
