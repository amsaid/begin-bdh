const arc = require('@architect/functions')
const serverless = require('serverless-http');

const app = require('express')()
const authenticate = require('../../authenticate')
const params = require('../../params')
const proxy = require('../../proxy')

const PORT = process.env.PORT || 8080

app.enable('trust proxy')
app.get('/', authenticate, params, proxy)
app.get('/favicon.ico', (req, res) => res.status(204).end())
//pp.listen(PORT, () => console.log(`Listening on ${PORT}`))

let server = serverless(app)
exports.handler = arc.http.async(server)


