# 🚀 Antigravity

> A modern cross-platform note-taking application with an interactive canvas interface

[![React Native](https://img.shields.io/badge/React%20Native-0.81.5-61DAFB?style=flat-square&logo=react)](https://reactnative.dev)
[![Expo](https://img.shields.io/badge/Expo-54.0.25-000020?style=flat-square&logo=expo)](https://expo.dev)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)

---

## ✨ Features

- 📝 **Interactive Canvas** - Drag, drop, and organize notes freely on an infinite canvas
- 💾 **Persistent Storage** - MMKV-powered local storage for lightning-fast data access
- 🎨 **Beautiful UI** - Modern design with smooth animations and transitions
- 📱 **Cross-Platform** - Works seamlessly on iOS, Android, and Web
- 🌙 **Dark Mode** - Automatic light/dark theme based on system preferences
- ✍️ **Rich Note Editing** - Full-featured modal editor with haptic feedback
- 🔄 **Real-time State Management** - Zustand state management for smooth UX
- ⚡ **Performance Optimized** - Built with React 19 and modern performance patterns

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React Native 0.81.5 + Expo 54 |
| **Navigation** | Expo Router (file-based routing) |
| **State Management** | Zustand 5.0 |
| **Storage** | React Native MMKV |
| **Animations** | React Native Reanimated |
| **UI Components** | React Native Screens |
| **Styling** | React Native Unistyles |
| **Type Safety** | TypeScript 5.9 |
| **Development** | Nitro Modules, React Compiler |

---

## 📋 Requirements

- **Node.js** 18+ or 20+
- **npm** or **yarn**
- **JDK 21** (for Android builds)
- **Android SDK** (for Android development)
- **Xcode** (for iOS development - macOS only)

---

## 🚀 Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Development Server

```bash
npm start
```

### 3. Run on Platform

**Android:**
```bash
npm run android
```

**iOS:**
```bash
npm run ios
```

**Web:**
```bash
npm run web
```

---

## 📁 Project Structure

```
antigravity/
├── app/                      # App entry point & routing
│   ├── (tabs)/              # Tab-based navigation
│   ├── modal.tsx            # Modal screens
│   └── _layout.tsx          # Root layout
├── src/
│   ├── components/
│   │   ├── canvas/          # Canvas & notes UI
│   │   ├── modals/          # Editor & modals
│   │   └── ui/              # Reusable components
│   ├── contexts/            # React contexts
│   ├── store/               # Zustand stores
│   ├── types/               # TypeScript types
│   └── styles/              # Theme & global styles
├── components/              # Shared components
├── constants/               # App constants
├── hooks/                   # Custom hooks
└── assets/                  # Images & static files
```

---

## 🎮 Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start Expo dev server |
| `npm run android` | Build & run on Android |
| `npm run ios` | Build & run on iOS |
| `npm run web` | Start web version |
| `npm run lint` | Run ESLint checks |
| `npm run reset-project` | Reset to blank project |

---

## 🎯 Usage

### Creating a Note
1. Tap the floating action button (FAB)
2. Enter your note content
3. Tap save

### Canvas Navigation
- **Drag** to move around the canvas
- **Pinch** to zoom in/out
- **Tap note** to edit
- **Swipe delete** to remove notes

### Theme
The app automatically respects your system theme preference (light/dark mode).

---

## 🏗️ Architecture

### State Management
Notes are managed using Zustand with MMKV persistence:
```typescript
const useNotesStore = create<NotesStore>(
  persist(
    (set) => ({
      // State & actions
    }),
    { name: 'notes-store' }
  )
);
```

### Canvas Context
Canvas positioning and zoom state managed via React Context for efficient rendering.

### Type Safety
Full TypeScript support ensures type safety across the application:
```typescript
interface Note {
  id: string;
  content: string;
  x: number;
  y: number;
  color: string;
  createdAt: number;
  updatedAt: number;
}
```

---

## 🐛 Troubleshooting

### Android Build Issues
If you encounter Java version conflicts, the project is configured to use JDK 21 via `gradle.properties`.

### Metro Cache Issues
Clear the cache with:
```bash
npm start -- --reset-cache
```

### Storage Issues
Clear app cache:
```bash
npx expo prebuild --clean
```

---

## 📝 Development Notes

- Uses **Expo Router** for file-based routing
- **React Compiler** enabled for automatic optimization
- **New Architecture** enabled for better performance
- **Edge-to-edge** rendering for immersive experience

---

## 📄 License

This project is licensed under the MIT License - see individual files for details.

---

## 🤝 Contributing

Contributions are welcome! Feel free to submit issues and pull requests.

---

## 📞 Support

For issues, questions, or suggestions:
- Open an issue on the repository
- Check existing documentation
- Review the Expo docs at [expo.dev](https://expo.dev)

---

**Built with ❤️ using React Native & Expo**
