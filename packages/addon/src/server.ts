import express, { Request, Response } from 'express';
import path from 'path';
import { AIOStreams } from './addon';
import { Config, StreamRequest } from '@aiostreams/types';
import { validateConfig } from './config';
import { getManifest } from './manifest';
import { invalidConfig, missingConfig } from './responses';


const app = express();
const port = process.env.PORT || 3000;

const rootUrl = (req: Request) => `${req.protocol}://${req.hostname}${req.hostname === 'localhost' ? `:${port}` : ''}`;

// Built-in middleware for parsing JSON
app.use(express.json());

// Built-in middleware for parsing URL-encoded data
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.append('Access-Control-Allow-Origin', '*');
  res.append('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
  next();
});

app.use(express.static(path.join(__dirname, '../../frontend/out')));

app.get('/', (req, res) => {
  res.redirect('/configure');
});

app.get(['/configure', '/:config/configure'], (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/out/configure.html'));
});

app.get('/manifest.json', (req, res) => {
  res.status(200).json(getManifest(false));
});

app.get('/:config/manifest.json', (req, res) => {
  res.status(200).json(getManifest(true));
});

// Route for /stream
app.get('/stream/:type/:id', (req: Request, res: Response) => {

  res.status(200).json(missingConfig(rootUrl(req)));
});

app.get('/:config/stream/:type/:id', (req: Request, res: Response) => {
  const config = req.params.config;

  // Decode Base64 encoded JSON config
  const decodedConfig = Buffer.from(config, 'base64').toString('utf-8');
  let configJson: Config;
  try {
    configJson = JSON.parse(decodedConfig);
  } catch (error: any) {
    res.status(400).send('Invalid config');
    return;
  }

  const decodedPath = decodeURIComponent(req.path);

  const streamMatch = new RegExp(
    `/${config}/stream/(movie|series)/tt([0-9]{7,})(?::([0-9]+):([0-9]+))?\.json`
  ).exec(decodedPath);

  if (!streamMatch) {
    // log after removing config if present
    console.error(`Invalid request: ${decodedPath.replace(`/${config}`, '')}`);
    res.status(400).send('Invalid request');
    return;
  }

  const [type, id, season, episode] = streamMatch.slice(1);

  console.log(
    `Received /stream request with Type: ${type}, ID: ${id}, Season: ${season}, Episode: ${episode}`
  );

  let streamRequest: StreamRequest;

  switch (type) {
    case 'series':
      if (!season || !episode) {
        res.status(400).send('Invalid request');
        console.log(
          `Request type was series but season or episode was missing`
        );
        return;
      }
      streamRequest = {
        id,
        type: 'series',
        season,
        episode,
      };
      break;
    case 'movie':
      if (season || episode) {
        console.log(`Request type was movie but season or episode was present`);
        res.status(400).send('Invalid request');
        return;
      }
      streamRequest = {
        id,
        type: 'movie',
      };
      break;
    default:
      console.log(`Request type was invalid`);
      res.status(400).send('Invalid request');
      return;
  }
  try {
    const { valid, errorCode, errorMessage } = validateConfig(configJson);
    if (!valid) {
      console.error(`Invalid config: ${errorCode} - ${errorMessage}`);
      res.status(200).json(invalidConfig(rootUrl(req), errorMessage ?? 'Unknown'));
    }

    const aioStreams = new AIOStreams(configJson);
    aioStreams.getStreams(streamRequest).then((streams) => {
      res.status(200).json({ streams: streams });
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).send(error.message);
  }
});

// define 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '../../frontend/out/404.html'));
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
