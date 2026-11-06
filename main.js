const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

let serverProcess;
let serverPort = Number(process.env.PORT || 3000);
let serverUrl = `http://127.0.0.1:${serverPort}`;
const debugMode = false;

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function getExternalEnvPath() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'settings', '.env')
    : path.join(__dirname, '.env');
}

function getPersistentStoragePath() {
  return path.join(app.getPath('userData'), 'storage');
}

function migrateStorage() {
  const target = getPersistentStoragePath();
  fs.mkdirSync(target, { recursive: true });

  for (const source of [path.join(__dirname, 'storage'), path.join(path.dirname(process.execPath), 'storage')]) {
    if (fs.existsSync(source) && path.resolve(source) !== path.resolve(target)) {
      fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false });
    }
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1200,
    minHeight: 800,
    autoHideMenuBar: true,
    backgroundColor: '#0b1020',
    icon: path.join(__dirname, 'icon.svg'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      allowRunningInsecureContent: false
    }
  });

  win.webContents.on('did-finish-load', () => {
    console.log('[PILAR] Interfaz cargada.');
    if (debugMode) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[PILAR] Error cargando ${validatedURL}: ${errorCode} ${errorDescription}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[PILAR] Renderer finalizado: ${details.reason || 'motivo desconocido'}`);
  });
  win.on('unresponsive', () => console.error('[PILAR] La ventana dejó de responder.'));
  win.loadURL(serverUrl);
  win.setTitle('PILAR del estudiante');
}

function startServer() {
  migrateStorage();
  fs.mkdirSync(path.dirname(getExternalEnvPath()), { recursive: true });
  console.log(`[PILAR] Iniciando servidor interno. cwd=${__dirname}`);
  console.log(`[PILAR] Archivo externo de entorno=${getExternalEnvPath()}`);

  return fetch(`${serverUrl}/api/health`)
    .then((response) => {
      if (response.ok) {
        return response.json();
      }
      throw new Error('El puerto está ocupado por otro servicio.');
    })
    .then(async (health) => {
      if (health?.ok && health.app === 'PILAR del estudiante') {
        console.log(`[PILAR] Se reutiliza una instancia existente en el puerto ${serverPort}.`);
        return false;
      }
      serverPort = await findAvailablePort();
      serverUrl = `http://127.0.0.1:${serverPort}`;
      serverProcess = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
        cwd: __dirname,
        stdio: 'inherit',
        windowsHide: !debugMode,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          NODE_ENV: app.isPackaged ? 'desktop' : (process.env.NODE_ENV || 'development'),
          PORT: String(serverPort),
          HOST: '127.0.0.1',
              PILAR_DEBUG: debugMode ? '1' : '0',
          PILAR_ALLOW_USER_API_KEY: '1',
              PILAR_ENV_PATH: getExternalEnvPath(),
              PILAR_DATA_PATH: getPersistentStoragePath()
        }
      });

      serverProcess.on('error', (error) => {
        console.error(`[PILAR] No se pudo iniciar el servidor interno: ${error.message}`);
      });
      serverProcess.on('exit', (code, signal) => {
        console.error(`[PILAR] Servidor interno terminó. code=${code} signal=${signal || 'none'}`);
      });
      return true;
    });
}

async function waitForServer() {
  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${serverUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error('El servidor interno no respondió a tiempo.');
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
}

app.whenReady().then(async () => {
  await startServer();
  try {
    await waitForServer();
    createWindow();
  } catch (error) {
    console.error(error.message);
    createWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', stopServer);
