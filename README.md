# SGP Tactical

An Android app built with Capacitor and Android Studio.

## Getting Started

### Prerequisites

- **Android Studio** (recommended)
- **JDK 21**
- **Android SDK** (SDK 36)

### Setup & Configuration

1. **Clone or Open the Project** in Android Studio.
2. **API Keys**: Copy `local.properties.example` to `local.properties` in the root folder:
   ```bash
   cp local.properties.example local.properties
   ```
3. Add your API keys (e.g. `ais.api.key`) inside `local.properties`.

> **Note on Security:** `local.properties` and generated configuration files are listed in `.gitignore` and will never be pushed to GitHub.

### Building the App

To build a debug APK from the command line:

```bash
./gradlew assembleDebug
```

The output APK will be generated at:
`app/build/outputs/apk/debug/app-debug.apk`

## Project Structure

- `app/src/main/java/` — Native Android Java sources
- `app/src/main/assets/public/` — Web application UI (HTML, CSS, JS)
- `capacitor-android/` — Capacitor core framework module
