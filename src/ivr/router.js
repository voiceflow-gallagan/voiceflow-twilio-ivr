require('dotenv').config()
const path = require('path')
const Router = require('express').Router
const { launch, interaction, deleteState } = require('./handler')

const RESET_STATE = process.env.RESET_STATE.toLowerCase() || 'false'

const router = new Router()

router.post('/interaction', async (req, res) => {
  const { Called, Caller, SpeechResult, Digits, CallStatus } = req.body

  if (CallStatus == 'completed' && RESET_STATE === 'true') {
    console.log('Resetting state')
    deleteState(Caller)
  } else {
    res.send(await interaction(Called, Caller, SpeechResult, Digits))
  }
})

router.post('/launch', async (req, res) => {
  const { Called, Caller } = req.body
  res.send(await launch(Called, Caller))
})

// Add a new endpoint to serve audio files
router.get('/audio/:filename', (req, res) => {
  const { filename } = req.params
  const filePath = path.join(process.cwd(), 'tmp', filename)
  res.sendFile(filePath)
})

module.exports = router
