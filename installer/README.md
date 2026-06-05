# Nyx First-Party GUI Installer

Nyx ships as one self-extracting Windows setup executable. Users run `NyxSetup.exe`, choose install options in the GUI, and the embedded payload is installed into their selected directory.

Developer build:

```powershell
.\tools\build-installer.ps1
```

Optional devtools module payload:

```powershell
.\tools\build-installer.ps1 -DevtoolsModule C:\path\to\devtools-module
```

The script builds the user-facing setup file:

- `dist-installer\NyxSetup.exe`
- `dist-installer\payload\` for inspection

User flow:

1. Run `NyxSetup.exe`.
2. Pick an install directory.
3. Choose optional install actions.
4. Click `Install`.

Default GUI install location:

```text
%LOCALAPPDATA%\Nyx
```

Silent install is still available for automation:

```powershell
.\NyxSetup.exe --silent --dir C:\Tools\Nyx
```

Payload layout:

```text
Nyx.exe
nyx-keyman.exe
dist\
assets\
runtime\
presets\
modules\
  devtools\
```

`modules\devtools` is reserved for a future devtools DLL/module bundle. The installer copies it if the build script receives `-DevtoolsModule` or if a local `devtools-module\` folder exists.
