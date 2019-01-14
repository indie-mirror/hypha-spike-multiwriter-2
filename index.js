const fs = require('fs')
const https = require('https')
const { pipeline } = require('stream')

const options = {
  key: fs.readFileSync('localhost-key.pem'),
  cert: fs.readFileSync('localhost.pem')
}

const routes = {
  '/': 'index.html',
  '/style.css': 'style.css',
  '/session25519.js': 'session25519.js',
  '/favicon.ico': 'favicon.ico'
}

https.createServer(options, (request, response) => {
  const url = request.url

  const fileToServe = routes[url]
  if (fileToServe !== undefined) {
    response.statusCode = 200
    pipeline(fs.createReadStream(fileToServe), response)
  } else {
    console.log(`Unknown path requested: ${url}`)
    response.statusCode = 404
    response.end('Not found.')
  }
}).listen(443, () => {
  console.log('Listening on port 443.')
})
