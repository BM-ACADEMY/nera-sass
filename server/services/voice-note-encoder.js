const fs = require('fs');
const { execFile } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);

// ffmpeg's built-in Ogg muxer produces a file that plays fine everywhere (ffplay, VLC,
// browsers) but WhatsApp's media pipeline silently rejects it after accepting the upload:
// the message reports "sent" and even gets a wamid, then a status webhook comes back
// minutes later with error 131053 ("however on processing it is of type
// application/octet-stream"). Re-muxing the same Opus audio with opusenc (the reference
// opus-tools encoder, `apt install opus-tools`) produces a file WhatsApp accepts and
// actually delivers — verified by sending both versions to a real number: the ffmpeg-only
// file failed every time, the opusenc file was delivered and read.
async function convertToWhatsAppVoiceNote(inputPath, outputPath) {
  const wavPath = `${outputPath}.tmp.wav`;
  await new Promise((resolve, reject) => {
    ffmpeg(inputPath).noVideo().audioChannels(1).format('wav').on('end', resolve).on('error', reject).save(wavPath);
  });
  try {
    await new Promise((resolve, reject) => {
      execFile('opusenc', ['--bitrate', '32', '--downmix-mono', wavPath, outputPath], (err) => (err ? reject(err) : resolve()));
    });
  } catch (opusencError) {
    // opus-tools isn't installed on this machine (e.g. local dev) — fall back to ffmpeg's
    // own encoder so uploads still work, even though WhatsApp may reject the result later.
    console.warn('[Voice Note] opusenc unavailable, falling back to ffmpeg ogg muxer:', opusencError.message);
    await new Promise((resolve, reject) => {
      ffmpeg(wavPath).audioCodec('libopus').audioChannels(1).audioBitrate('32k').format('ogg').on('end', resolve).on('error', reject).save(outputPath);
    });
  } finally {
    await fs.promises.unlink(wavPath).catch(() => {});
  }
}

module.exports = { convertToWhatsAppVoiceNote };
