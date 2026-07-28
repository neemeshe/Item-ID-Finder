# Item ID Finder — Live Website

A small live website: a public search page for procurement, and a password-protected
admin page for you to update the master data whenever it changes. No re-sending files.

## What's inside
- `server.js` — the backend (search API + admin update endpoint)
- `public/index.html` — the search page anyone with the link can use
- `public/admin.html` — the update page, locked behind a password
- `data.json` — seeded with your current master data (561 items) so it works immediately

## Deploying (using Render — free, no credit card required)

1. **Put this project on GitHub** (Render deploys from a GitHub repo):
   - Go to github.com, create a free account if you don't have one, create a new repository (e.g. `item-id-finder`).
   - Upload all the files in this folder to that repository (GitHub's web interface lets you drag-and-drop files — you don't need any command-line tools).

2. **Create a Render account**: go to render.com and sign up (no credit card needed for the free tier).

3. **Create a new Web Service**:
   - Click "New +" → "Web Service."
   - Connect your GitHub account and select the repository you just created.
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Choose the **Free** instance type.

4. **Set your admin password**:
   - In the Render dashboard for your new service, go to "Environment."
   - Add an environment variable: `ADMIN_PASSWORD` = *(choose your own password here)*.
   - This keeps your password out of the code itself — nobody looking at the GitHub repo can see it.

5. **Deploy.** Render will build and start the service, then give you a live URL like
   `https://item-id-finder-xxxx.onrender.com`. That's the link for procurement.
   The admin page is the same URL with `/admin.html` at the end.

## Important things to know

- **Free tier goes to sleep.** After ~15 minutes without visitors, the free instance
  pauses and takes a few seconds to wake up on the next visit. That's normal and fine
  for an internal tool — just don't expect instant loading if nobody's used it in a while.

- **Test that your data survives a restart before relying on it.** This version stores
  data in a simple file on the server's disk. Some free hosting tiers keep this reliably;
  others may reset local files on redeploy. Publish some data, wait for the service to go
  idle and wake back up, and check `/api/status` still shows your item count. If it doesn't
  persist reliably, the fix is to connect a small managed database (Render offers a free
  PostgreSQL option) instead of the local file — come back and I can wire that in.

- **Changing the admin password later**: just update the `ADMIN_PASSWORD` environment
  variable in Render's dashboard and redeploy — no code changes needed.

- **Updating the master data**: open `/admin.html`, enter the password, upload or paste
  the newer data, confirm the column mapping, and click "Publish." It's live for everyone
  immediately — no redeploying, no resending files.
