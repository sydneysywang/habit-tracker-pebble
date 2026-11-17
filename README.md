# Pebble

A minimalist, low-guilt habit tracker. You collect stones instead of protecting streaks.

Each habit is a stone: a **Tiny Pebble**, a **Smooth Stone**, or a **Heavy Boulder**. Today's stones live in a small **Daily Pocket** with a weight limit of 10. When you tick a habit, its stone drops into a glass jar with real 2D physics and soft clack sounds. You can drag the stones around and throw them. When everything is ticked, your pocket is empty. Tomorrow it refills, and nothing gets "broken".

- Add, edit (✎ or double-click), and remove habits. Press Enter to add.
- A 7-day grid shows which days each habit was collected.
- Your data is saved in `localStorage` and stays in this browser.
- Built with plain HTML, CSS, and JavaScript modules: no frameworks, no build step, no server.

## Run locally

ES modules don't load from `file://`, so serve the folder over HTTP:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploy to GitHub Pages

Push to `main`, then go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, and select `main` with the `/ (root)` folder. The `.nojekyll` file makes GitHub serve the files as they are.
