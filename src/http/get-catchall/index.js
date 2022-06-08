const arc = require('@architect/functions')
const serverless = require('serverless-http');

const app = require('express')()

const auth = require('basic-auth')
const LOGIN = process.env.LOGIN
const PASSWORD = process.env.PASSWORD

function authenticate(req, res, next) {
  if (LOGIN && PASSWORD) {
    const credentials = auth(req)
    if (!credentials || credentials.name !== LOGIN || credentials.pass !== PASSWORD) {
      res.setHeader('WWW-Authenticate', `Basic realm="Bandwidth-Hero Compression Service"`)

      return res.status(401).end('Access denied')
    }
  }

  next()
}


const DEFAULT_QUALITY = 40

function params(req, res, next) {
  let url = req.query.url
  if (Array.isArray(url)) url = url.join('&url=')
  if (!url) return res.end('bandwidth-hero-proxy')

  url = url.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, 'http://')
  req.params.url = url
  req.params.webp = !req.query.jpeg
  req.params.grayscale = req.query.bw != 0
  req.params.quality = parseInt(req.query.l, 10) || DEFAULT_QUALITY

  next()
}

const request = require('request')
const pick = require('lodash').pick

const MIN_COMPRESS_LENGTH = 1024
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100

function shouldCompress(req) {
  const { originType, originSize, webp } = req.params

  if (!originType.startsWith('image')) return false
  if (originSize === 0) return false
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false
  if (
    !webp &&
    (originType.endsWith('png') || originType.endsWith('gif')) &&
    originSize < MIN_TRANSPARENT_COMPRESS_LENGTH
  ) {
    return false
  }

  return true
}


function redirect(req, res) {
  if (res.headersSent) return

  res.setHeader('content-length', 0)
  res.removeHeader('cache-control')
  res.removeHeader('expires')
  res.removeHeader('date')
  res.removeHeader('etag')
  res.setHeader('location', encodeURI(req.params.url))
  res.status(302).end()
}

const sharp = require('sharp')

function compress(req, res, input) {
  const format = req.params.webp ? 'webp' : 'jpeg'

  sharp(input)
    .grayscale(req.params.grayscale)
    .toFormat(format, {
      quality: req.params.quality,
      progressive: true,
      optimizeScans: true
    })
    .toBuffer((err, output, info) => {
      if (err || !info || res.headersSent) return redirect(req, res)

      res.setHeader('content-type', `image/${format}`)
      res.setHeader('content-length', info.size)
      res.setHeader('x-original-size', req.params.originSize)
      res.setHeader('x-bytes-saved', req.params.originSize - info.size)
      res.status(200)
      res.write(output)
      res.end()
    })
}

function bypass(req, res, buffer) {
  res.setHeader('x-proxy-bypass', 1)
  res.setHeader('content-length', buffer.length)
  res.status(200)
  res.write(buffer)
  res.end()
}

function copyHeaders(source, target) {
  for (const [key, value] of Object.entries(source.headers)) {
    try {
      target.setHeader(key, value)
    } catch (e) {
      console.log(e.message)
    }
  }
}


function proxy(req, res) {
  request.get(
    req.params.url,
    {
      headers: {
        ...pick(req.headers, ['cookie', 'dnt', 'referer']),
        'user-agent': 'Bandwidth-Hero Compressor',
        'x-forwarded-for': req.headers['x-forwarded-for'] || req.ip,
        via: '1.1 bandwidth-hero'
      },
      timeout: 10000,
      maxRedirects: 5,
      encoding: null,
      strictSSL: false,
      gzip: true,
      jar: true
    },
    (err, origin, buffer) => {
      if (err || origin.statusCode >= 400) return redirect(req, res)

      copyHeaders(origin, res)
      res.setHeader('content-encoding', 'identity')
      req.params.originType = origin.headers['content-type'] || ''
      req.params.originSize = buffer.length

      if (shouldCompress(req)) {
        compress(req, res, buffer)
      } else {
        bypass(req, res, buffer)
      }
    }
  )
}

const PORT = process.env.PORT || 8080

app.enable('trust proxy')
app.get('/', authenticate, params, proxy)
app.get('/favicon.ico', (req, res) => res.status(204).end())
//pp.listen(PORT, () => console.log(`Listening on ${PORT}`))

let server = serverless(app)
exports.handler = arc.http.async(server)


