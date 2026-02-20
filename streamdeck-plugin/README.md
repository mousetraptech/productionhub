# Production Hub — Stream Deck XL Plugin

Connects a Stream Deck XL (32 keys) to Production Hub for live show control. Loads deck profiles, fires composite actions, and shows live device state feedback.

## Development Setup

1. Install the Stream Deck CLI:
   ```bash
   npm install -g @elgato/cli
   ```

2. Build the plugin:
   ```bash
   cd streamdeck-plugin
   npm install
   npm run build
   ```

3. Link into Stream Deck app:
   ```bash
   streamdeck link com.productionhub.deck.sdPlugin
   ```

4. Restart the Stream Deck app.

5. In the Stream Deck app, drag 32 "PH Button" actions onto all keys of your XL layout.

## Configuration

The plugin connects to Production Hub at:
- **ModWS** `localhost:3001` — deck profiles, action firing
- **DashboardWS** `localhost:8081` — live device state (ChamSys, OBS, VISCA, Avantis)

It loads the "main" deck profile by default.

## Pre-built Profile

To create a bundled profile that auto-installs all 32 keys:
1. Set up the 32-key layout in Stream Deck app
2. Export the profile (Preferences → Profiles → right-click → Export)
3. Place the `.streamDeckProfile` file in `com.productionhub.deck.sdPlugin/profiles/`
4. Add the Profiles array to manifest.json
