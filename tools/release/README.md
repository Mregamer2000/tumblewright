# Auto-updates

Give people one `index.html` once. When you publish a new version, their copy downloads it in the
background, checks it was signed by you, and switches to it the next time they start the game (or right
away if they press **Restart now** in the lobby).

## One-time setup

1. Pick where updates will live, e.g. a free Vercel or GitHub Pages site: `https://tumblewright.vercel.app/`
2. Run, from the project folder:

   ```
   node tools/release/release.mjs init https://tumblewright.vercel.app/
   ```

   This creates `release/update-key.pem` (your private signing key) and `release/config.json`.
   **Back up `update-key.pem` and never share it.** If it's lost, existing copies can't be updated and
   everyone needs a new file. If it leaks, someone could sign fake updates.

## Every release

```
node tools/release/release.mjs publish "What's new in this version"
```

This bumps the version (`publish minor "..."`, `publish major "..."` or `publish 1.4.0 "..."` also work),
stamps it into `index.html`, signs it, and writes `release/public/`:

| file          | what it is                                                          |
|---------------|---------------------------------------------------------------------|
| `index.html`  | the game (also the file you hand out)                               |
| `update.json` | version, size, signature and release notes that copies check        |
| `vercel.json` | lets copies opened from disk read the files (CORS) and skips caching |

Upload the whole `release/public` folder to your site, e.g. `cd release/public` then `npx vercel --prod`.
GitHub Pages works too: commit the folder's files to the Pages branch.

## How it behaves for players

- The update check runs when the game starts and then every 30 minutes, and never interrupts a game in progress.
- An update is only installed if its signature matches the public key inside the player's file.
  Tampered or corrupted downloads are rejected.
- If an update ever fails to start, the next launch throws it away and runs the version inside the file.
- Everyone in a room must run the same version. A player on another version gets a clear message instead of a broken game.
- Settings → Network shows the version and update status, with a **Check now** button.
- The very first copy you hand out must be one made by `publish` (it contains the update address and key).
  Copies from before this system existed can't update themselves.
