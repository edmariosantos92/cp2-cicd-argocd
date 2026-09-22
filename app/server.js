const express = require('express');
const { version: pkgVersion } = require('./package.json');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = process.env.APP_VERSION || pkgVersion;
const APP_COLOR = process.env.APP_COLOR || '#0f766e';
const APP_TITLE = process.env.APP_TITLE || 'CP2 - CI/CD com GitHub Actions e Argo CD';

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="pt-br">
<head><meta charset="UTF-8"><title>${APP_TITLE}</title></head>
<body style="background-color:${APP_COLOR}; color:#fff; font-family: sans-serif; text-align:center; padding-top: 15vh;">
  <h1>${APP_TITLE}</h1>
  <h2>Versao: ${APP_VERSION}</h2>
  <p>Deploy automatizado via GitHub Actions + Argo CD</p>
</body>
</html>`);
});

app.get('/health', (req, res) => res.status(200).send('ok'));

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
