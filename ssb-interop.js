/**
 * The preload script needs to stay in regular ole JavaScript, because it is
 * the point of entry for electron-compile.
 */

const allowedChildWindowEventMethod = [
  'windowWithTokenBeganLoading',
  'windowWithTokenFinishedLoading',
  'windowWithTokenCrashed',
  'windowWithTokenDidChangeGeometry',
  'windowWithTokenBecameKey',
  'windowWithTokenResignedKey',
  'windowWithTokenWillClose'
];

if (window.location.href !== 'about:blank') {
  const preloadStartTime = process.hrtime();

  require('./assign-metadata').assignMetadata();
  if (window.parentWebContentsId) {
      //tslint:disable-next-line:no-console max-line-length
      const warn = () => console.warn(`Deprecated: direct access to global object 'parentInfo' will be disallowed. 'parentWebContentsId' will be available until new interface is ready.`);
      Object.defineProperty(window, 'parentInfo', {
          get: () => {
              warn();
              return {
                  get webContentsId() {
                      warn();
                      return parentWebContentsId;
                  }
              };
          }
      });
  }

  const { ipcRenderer, remote } = require('electron');

  ipcRenderer
      .on('SLACK_NOTIFY_CHILD_WINDOW_EVENT', (event, method, ...args) => {
          try {
              if (!TSSSB || !TSSSB[method]) throw new Error('Webapp is not fully loaded to execute method');
              if (!allowedChildWindowEventMethod.includes(method)) {
                  throw new Error('Unsupported method');
              }

              TSSSB[method](...args);
          } catch (error) {
              console.error(`Cannot execute method`, { error, method }); //tslint:disable-line:no-console
          }
      });

  ipcRenderer
      .on('SLACK_REMOTE_DISPATCH_EVENT', (event, data, origin, browserWindowId) => {
          const evt = new Event('message');
          evt.data = JSON.parse(data);
          evt.origin = origin;
          evt.source = {
              postMessage: (message) => {
                  if (!desktop || !desktop.window || !desktop.window.postMessage) throw new Error('desktop not ready');
                  return desktop.window.postMessage(message, browserWindowId);
              }
          };

          window.dispatchEvent(evt);
          event.sender.send('SLACK_REMOTE_DISPATCH_EVENT');
      });

  const { init } = require('electron-compile');
  const path = require('path');

  const { isPrebuilt } = require('../utils/process-helpers');

  //tslint:disable-next-line:no-console
  process.on('uncaughtException', (e) => console.error(e));

  /**
   * Patch Node.js globals back in, refer to
   * https://electron.atom.io/docs/api/process/#event-loaded.
   */
  const processRef = window.process;
  process.once('loaded', () => {
      window.process = processRef;
  });

  window.perfTimer.PRELOAD_STARTED = preloadStartTime;

  // Consider "initial team booted" as whether the workspace is the first loaded after Slack launches
  ipcRenderer.once('SLACK_PRQ_TEAM_BOOT_ORDER', (_event, order) => {
      window.perfTimer.isInitialTeamBooted = order === 1;
  });
  ipcRenderer.send('SLACK_PRQ_TEAM_BOOTED'); // Main process will respond SLACK_PRQ_TEAM_BOOT_ORDER

  const resourcePath = path.join(__dirname, '..', '..');
  const mainModule = require.resolve('../ssb/main.ts');
  const isDevMode = loadSettings.devMode && isPrebuilt();

  init(resourcePath, mainModule, !isDevMode);
}

/**
 *  REMOVE EVERYTHING BELOW TO REVERT TO NORMAL SLACK
 */

// remove any custom sidebar theme
window.onload = () => {
    // this is really hacky, should probably find a better way to do this...
    setTimeout(() => {
        const nav = document.getElementsByTagName('style');

        for (let i = 0; i < nav.length; i++) {
            let item = nav[i];
            if (item.className === 'p-channel_sidebar__theme--custom_theme') {
                item.innerHTML = '';
            }
        }
    }, 1500)
};

// Slack Dark Mode
document.addEventListener("DOMContentLoaded", function() {
  // Then get its webviews
  let webviews = document.querySelectorAll(".TeamView webview");
  // Fetch our CSS in parallel ahead of time
  const cssPath = 'https://raw.githubusercontent.com/RPuffer/slack-dark-theme/master/dark.css';
  let cssPromise = fetch(cssPath).then(response => response.text());

  let customCSS = `
    :root {
        /* Modify these to change your theme colors: */
        --text: #dadada;
        --bg-main: #222;
        --bg-sidebar: #2c2c2c;
        --bg-med: #363636;
        --bg-light: #424242;
        --bg-highlight: #545454;
        --panda-red: #ff2c6d;
        --panda-blue: #72c3ff;
        --panda-teal: #35ffdc;
        --panda-pink: #ff95bf;
        --panda-orange: #ffb86c;
        --panda-purple: #b080f6;
    }
    /* add custom css here */
  `

  // Insert a style tag into the wrapper view
  cssPromise.then(css => {
      let s = document.createElement('style');
      s.type = 'text/css';
      s.innerHTML = css + customCSS;
      document.head.appendChild(s);
  });
  // Wait for each webview to load
  webviews.forEach(webview => {
      webview.addEventListener('ipc-message', message => {
          if (message.channel == 'didFinishLoading')
          // Finally add the CSS into the webview
              cssPromise.then(css => {
              let script = `
                let s = document.createElement('style');
                s.type = 'text/css';
                s.id = 'slack-custom-css';
                s.innerHTML = \`${css + customCSS}\`;
                document.head.appendChild(s);
              `
              webview.executeJavaScript(script);
          })
      });
  });
});