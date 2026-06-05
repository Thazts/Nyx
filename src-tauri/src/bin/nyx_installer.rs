#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
#![allow(non_snake_case)]

use std::env;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

const MAGIC: &[u8; 16] = b"NYXINSTALLERv001";
const FOOTER_LEN: u64 = 24;

// { EntryCount: u32, Entries: [{ PathLength: u16, DataLength: u64, Path: utf8, Data: bytes }], Footer: { Magic: [u8; 16], ArchiveOffset: u64 } }
fn main() {
    let Args: Vec<String> = env::args().collect();
    let Result = match Args.get(1).map(String::as_str) {
        Some("--pack") => PackMode(&Args),
        Some("--help") | Some("-h") => {
            PrintHelp();
            Ok(())
        }
        _ => InstallMode(&Args),
    };

    if let Err(Error) = Result {
        ShowFatalError(&Error);
        std::process::exit(1);
    }
}

fn PrintHelp() {
    println!("Nyx installer");
    println!();
    println!("Build setup exe:");
    println!("  nyx-installer.exe --pack <stub-exe> <payload-dir> <out-exe>");
    println!();
    println!("User install:");
    println!("  NyxSetup.exe");
    println!();
    println!("Silent install:");
    println!("  NyxSetup.exe --silent [--dir <install-dir>] [--no-shortcut] [--no-devtools]");
}

fn PackMode(Args: &[String]) -> Result<(), String> {
    if Args.len() != 5 {
        return Err(
            "usage: nyx-installer.exe --pack <stub-exe> <payload-dir> <out-exe>".to_string(),
        );
    }
    let Stub = Path::new(&Args[2]);
    let Payload = Path::new(&Args[3]);
    let Out = Path::new(&Args[4]);

    if !Stub.is_file() {
        return Err(format!("stub exe not found: {}", Stub.display()));
    }
    if !Payload.is_dir() {
        return Err(format!("payload dir not found: {}", Payload.display()));
    }
    if let Some(Parent) = Out.parent() {
        fs::create_dir_all(Parent).map_err(|Error| format!("cannot create output dir: {Error}"))?;
    }

    fs::copy(Stub, Out).map_err(|Error| format!("cannot copy stub: {Error}"))?;
    let mut File = fs::OpenOptions::new()
        .append(true)
        .read(true)
        .open(Out)
        .map_err(|Error| format!("cannot open output: {Error}"))?;
    let ArchiveOffset = File
        .seek(SeekFrom::End(0))
        .map_err(|Error| Error.to_string())?;

    let mut Entries = Vec::new();
    CollectEntries(Payload, Payload, &mut Entries)?;
    Entries.sort_by(|A, B| A.0.cmp(&B.0));

    File.write_all(&(Entries.len() as u32).to_le_bytes())
        .map_err(|Error| Error.to_string())?;
    for (RelativePath, Path) in Entries {
        let RelativeBytes = RelativePath.as_bytes();
        let Data =
            fs::read(&Path).map_err(|Error| format!("cannot read {}: {Error}", Path.display()))?;
        File.write_all(&(RelativeBytes.len() as u16).to_le_bytes())
            .map_err(|Error| Error.to_string())?;
        File.write_all(&(Data.len() as u64).to_le_bytes())
            .map_err(|Error| Error.to_string())?;
        File.write_all(RelativeBytes)
            .map_err(|Error| Error.to_string())?;
        File.write_all(&Data).map_err(|Error| Error.to_string())?;
    }

    File.write_all(MAGIC).map_err(|Error| Error.to_string())?;
    File.write_all(&ArchiveOffset.to_le_bytes())
        .map_err(|Error| Error.to_string())?;
    Ok(())
}

fn InstallMode(Args: &[String]) -> Result<(), String> {
    if Args.iter().any(|Arg| Arg == "--silent") {
        return SilentInstallMode(Args);
    }

    #[cfg(target_os = "windows")]
    {
        return WindowsGui::RunGuiInstaller();
    }

    #[cfg(not(target_os = "windows"))]
    {
        SilentInstallMode(Args)
    }
}

fn SilentInstallMode(Args: &[String]) -> Result<(), String> {
    let InstallerExe =
        env::current_exe().map_err(|Error| format!("cannot locate installer exe: {Error}"))?;
    let ArchiveOffset = ReadArchiveOffset(&InstallerExe)?;
    let InstallDir = RequestedInstallDir(Args)?;
    let Options = InstallerOptions {
        CreateDesktopShortcut: !Args.iter().any(|Arg| Arg == "--no-shortcut"),
        LaunchAfterInstall: Args.iter().any(|Arg| Arg == "--launch"),
        InstallDevtools: !Args.iter().any(|Arg| Arg == "--no-devtools"),
    };

    fs::create_dir_all(&InstallDir)
        .map_err(|Error| format!("cannot create install dir: {Error}"))?;
    ExtractArchive(
        &InstallerExe,
        ArchiveOffset,
        &InstallDir,
        Options,
        Option::<fn(&str)>::None,
    )?;

    if Options.CreateDesktopShortcut {
        CreateShortcuts(&InstallDir)?;
    }
    if Options.LaunchAfterInstall {
        LaunchNyx(&InstallDir)?;
    }

    Ok(())
}

// { CreateDesktopShortcut: bool, LaunchAfterInstall: bool, InstallDevtools: bool }
#[derive(Clone, Copy)]
struct InstallerOptions {
    CreateDesktopShortcut: bool,
    LaunchAfterInstall: bool,
    InstallDevtools: bool,
}

// { HasDevtoolsModule: bool }
#[derive(Clone, Copy)]
struct InstallerPayloadInfo {
    HasDevtoolsModule: bool,
}

fn CollectEntries(Root: &Path, Dir: &Path, Out: &mut Vec<(String, PathBuf)>) -> Result<(), String> {
    for Entry in
        fs::read_dir(Dir).map_err(|Error| format!("cannot read {}: {Error}", Dir.display()))?
    {
        let Entry = Entry.map_err(|Error| Error.to_string())?;
        let Path = Entry.path();
        let Name = Path
            .file_name()
            .and_then(|Name| Name.to_str())
            .unwrap_or("");
        if Name == ".git" || Name == "target" || Name == "node_modules" {
            continue;
        }
        if Path.is_dir() {
            CollectEntries(Root, &Path, Out)?;
        } else if Path.is_file() {
            let RelativePath = Path
                .strip_prefix(Root)
                .map_err(|Error| Error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            Out.push((RelativePath, Path));
        }
    }
    Ok(())
}

fn ReadArchiveOffset(Exe: &Path) -> Result<u64, String> {
    let mut File =
        fs::File::open(Exe).map_err(|Error| format!("cannot open installer: {Error}"))?;
    let Len = File.metadata().map_err(|Error| Error.to_string())?.len();
    if Len < FOOTER_LEN {
        return Err("installer has no embedded payload".to_string());
    }
    File.seek(SeekFrom::End(-(FOOTER_LEN as i64)))
        .map_err(|Error| Error.to_string())?;
    let mut Magic = [0u8; 16];
    let mut Offset = [0u8; 8];
    File.read_exact(&mut Magic)
        .map_err(|Error| Error.to_string())?;
    File.read_exact(&mut Offset)
        .map_err(|Error| Error.to_string())?;
    if &Magic != MAGIC {
        return Err("installer payload marker not found; build NyxSetup.exe with tools\\build-installer.ps1".to_string());
    }
    Ok(u64::from_le_bytes(Offset))
}

fn ReadPayloadInfo(Exe: &Path, ArchiveOffset: u64) -> Result<InstallerPayloadInfo, String> {
    let mut HasDevtoolsModule = false;
    WalkArchiveEntries(Exe, ArchiveOffset, |RelativePath, _DataLength| {
        if RelativePath.starts_with("modules/devtools/") {
            HasDevtoolsModule = true;
        }
        Ok(())
    })?;
    Ok(InstallerPayloadInfo { HasDevtoolsModule })
}

fn WalkArchiveEntries<F>(Exe: &Path, ArchiveOffset: u64, mut VisitEntry: F) -> Result<(), String>
where
    F: FnMut(&str, u64) -> Result<(), String>,
{
    let mut File =
        fs::File::open(Exe).map_err(|Error| format!("cannot open installer: {Error}"))?;
    File.seek(SeekFrom::Start(ArchiveOffset))
        .map_err(|Error| Error.to_string())?;
    let mut CountBuf = [0u8; 4];
    File.read_exact(&mut CountBuf)
        .map_err(|Error| Error.to_string())?;
    let Count = u32::from_le_bytes(CountBuf);

    for _ in 0..Count {
        let mut PathLenBuf = [0u8; 2];
        let mut DataLenBuf = [0u8; 8];
        File.read_exact(&mut PathLenBuf)
            .map_err(|Error| Error.to_string())?;
        File.read_exact(&mut DataLenBuf)
            .map_err(|Error| Error.to_string())?;
        let PathLen = u16::from_le_bytes(PathLenBuf) as usize;
        let DataLength = u64::from_le_bytes(DataLenBuf);
        let mut PathBuf = vec![0u8; PathLen];
        File.read_exact(&mut PathBuf)
            .map_err(|Error| Error.to_string())?;
        let RelativePath = String::from_utf8(PathBuf).map_err(|Error| Error.to_string())?;
        VisitEntry(&RelativePath, DataLength)?;
        File.seek(SeekFrom::Current(DataLength as i64))
            .map_err(|Error| Error.to_string())?;
    }

    Ok(())
}

fn ExtractArchive<F>(
    Exe: &Path,
    ArchiveOffset: u64,
    InstallDir: &Path,
    Options: InstallerOptions,
    mut OnEntry: Option<F>,
) -> Result<(), String>
where
    F: FnMut(&str),
{
    let mut File =
        fs::File::open(Exe).map_err(|Error| format!("cannot open installer: {Error}"))?;
    File.seek(SeekFrom::Start(ArchiveOffset))
        .map_err(|Error| Error.to_string())?;
    let mut CountBuf = [0u8; 4];
    File.read_exact(&mut CountBuf)
        .map_err(|Error| Error.to_string())?;
    let Count = u32::from_le_bytes(CountBuf);

    for _ in 0..Count {
        let mut PathLenBuf = [0u8; 2];
        let mut DataLenBuf = [0u8; 8];
        File.read_exact(&mut PathLenBuf)
            .map_err(|Error| Error.to_string())?;
        File.read_exact(&mut DataLenBuf)
            .map_err(|Error| Error.to_string())?;
        let PathLen = u16::from_le_bytes(PathLenBuf) as usize;
        let DataLength = u64::from_le_bytes(DataLenBuf);
        let mut PathBuf = vec![0u8; PathLen];
        File.read_exact(&mut PathBuf)
            .map_err(|Error| Error.to_string())?;
        let RelativePath = String::from_utf8(PathBuf).map_err(|Error| Error.to_string())?;

        if ShouldSkipEntry(&RelativePath, Options) {
            File.seek(SeekFrom::Current(DataLength as i64))
                .map_err(|Error| Error.to_string())?;
            continue;
        }

        if let Some(Callback) = OnEntry.as_mut() {
            Callback(&RelativePath);
        }

        let Target = SafeInstallPath(InstallDir, &RelativePath)?;
        if let Some(Parent) = Target.parent() {
            fs::create_dir_all(Parent)
                .map_err(|Error| format!("cannot create {}: {Error}", Parent.display()))?;
        }
        let mut Out = fs::File::create(&Target)
            .map_err(|Error| format!("cannot write {}: {Error}", Target.display()))?;
        std::io::copy(
            &mut std::io::Read::by_ref(&mut File).take(DataLength),
            &mut Out,
        )
        .map_err(|Error| Error.to_string())?;
    }
    Ok(())
}

fn ShouldSkipEntry(RelativePath: &str, Options: InstallerOptions) -> bool {
    RelativePath.starts_with("modules/devtools/") && !Options.InstallDevtools
}

fn SafeInstallPath(Root: &Path, RelativePath: &str) -> Result<PathBuf, String> {
    if RelativePath.contains("..")
        || RelativePath.starts_with('/')
        || RelativePath.starts_with('\\')
        || RelativePath.contains(':')
    {
        return Err(format!("unsafe payload path: {RelativePath}"));
    }
    Ok(Root.join(RelativePath.replace('/', "\\")))
}

fn RequestedInstallDir(Args: &[String]) -> Result<PathBuf, String> {
    if let Some(Index) = Args.iter().position(|Arg| Arg == "--dir") {
        let Value = Args.get(Index + 1).ok_or("--dir requires a path")?;
        return Ok(PathBuf::from(Value));
    }
    Ok(DefaultInstallDir())
}

fn DefaultInstallDir() -> PathBuf {
    let Base = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    Base.join("Nyx")
}

fn CreateShortcuts(InstallDir: &Path) -> Result<(), String> {
    let Exe = InstallDir.join("Nyx.exe");
    if !Exe.exists() {
        return Ok(());
    }
    let Desktop = env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|Path| Path.join("Desktop").join("Nyx.lnk"));
    let Some(Shortcut) = Desktop else {
        return Ok(());
    };
    let Script = format!(
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.WorkingDirectory='{}';$s.Save()",
        PsEscape(&Shortcut),
        PsEscape(&Exe),
        PsEscape(InstallDir),
    );
    let _ = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &Script,
        ])
        .status();
    Ok(())
}

fn LaunchNyx(InstallDir: &Path) -> Result<(), String> {
    let Exe = InstallDir.join("Nyx.exe");
    if Exe.exists() {
        Command::new(&Exe)
            .current_dir(InstallDir)
            .spawn()
            .map_err(|Error| format!("cannot launch Nyx: {Error}"))?;
    }
    Ok(())
}

fn PsEscape(Path: &Path) -> String {
    Path.to_string_lossy().replace('\'', "''")
}

fn ShowFatalError(Message: &str) {
    #[cfg(target_os = "windows")]
    {
        WindowsGui::MessageBoxError("Nyx Setup", Message);
    }
    #[cfg(not(target_os = "windows"))]
    {
        eprintln!("error: {Message}");
    }
}

#[cfg(target_os = "windows")]
mod WindowsGui {
    use super::*;
    use std::mem::zeroed;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{
        GetStockObject, UpdateWindow, COLOR_WINDOW, DEFAULT_GUI_FONT,
    };
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::EnableWindow;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW,
        GetWindowTextW, LoadCursorW, MessageBoxW, PostQuitMessage, RegisterClassW, SendMessageW,
        SetWindowTextW, ShowWindow, TranslateMessage, BM_GETCHECK, BM_SETCHECK, BS_AUTOCHECKBOX,
        BS_PUSHBUTTON, CW_USEDEFAULT, ES_AUTOHSCROLL, GWLP_USERDATA, HMENU, IDC_ARROW,
        MB_ICONERROR, MB_ICONINFORMATION, MB_OK, MSG, SW_SHOW, WM_CLOSE, WM_COMMAND, WM_CREATE,
        WM_DESTROY, WM_SETFONT, WNDCLASSW, WS_BORDER, WS_CAPTION, WS_CHILD, WS_DISABLED,
        WS_MINIMIZEBOX, WS_OVERLAPPED, WS_SYSMENU, WS_TABSTOP, WS_VISIBLE,
    };

    const ID_INSTALL_PATH: i32 = 1001;
    const ID_BROWSE: i32 = 1002;
    const ID_SHORTCUT: i32 = 1003;
    const ID_LAUNCH: i32 = 1004;
    const ID_DEVTOOLS: i32 = 1005;
    const ID_INSTALL: i32 = 1006;
    const ID_STATUS: i32 = 1007;
    const BST_UNCHECKED: usize = 0;
    const BST_CHECKED: usize = 1;
    const SS_LEFT: u32 = 0;

    // { MainWindow: HWND, PathEdit: HWND, BrowseButton: HWND, ShortcutCheck: HWND, LaunchCheck: HWND, DevtoolsCheck: HWND, InstallButton: HWND, StatusLabel: HWND, InstallerExe: PathBuf, ArchiveOffset: u64, PayloadInfo: InstallerPayloadInfo }
    struct GuiState {
        MainWindow: HWND,
        PathEdit: HWND,
        BrowseButton: HWND,
        ShortcutCheck: HWND,
        LaunchCheck: HWND,
        DevtoolsCheck: HWND,
        InstallButton: HWND,
        StatusLabel: HWND,
        InstallerExe: PathBuf,
        ArchiveOffset: u64,
        PayloadInfo: InstallerPayloadInfo,
    }

    pub fn RunGuiInstaller() -> Result<(), String> {
        let InstallerExe =
            env::current_exe().map_err(|Error| format!("cannot locate installer exe: {Error}"))?;
        let ArchiveOffset = ReadArchiveOffset(&InstallerExe)?;
        let PayloadInfo = ReadPayloadInfo(&InstallerExe, ArchiveOffset)?;

        unsafe {
            let Instance = GetModuleHandleW(null());
            let ClassName = Wide("NyxInstallerWindow");
            let WindowClass = WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(WindowProc),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: Instance,
                hIcon: 0,
                hCursor: LoadCursorW(0, IDC_ARROW),
                hbrBackground: (COLOR_WINDOW + 1) as _,
                lpszMenuName: null(),
                lpszClassName: ClassName.as_ptr(),
            };
            if RegisterClassW(&WindowClass) == 0 {
                return Err("cannot register installer window".to_string());
            }

            let State = Box::new(GuiState {
                MainWindow: 0,
                PathEdit: 0,
                BrowseButton: 0,
                ShortcutCheck: 0,
                LaunchCheck: 0,
                DevtoolsCheck: 0,
                InstallButton: 0,
                StatusLabel: 0,
                InstallerExe,
                ArchiveOffset,
                PayloadInfo,
            });
            let StatePtr = Box::into_raw(State);

            let Title = Wide("Nyx Setup");
            let Window = CreateWindowExW(
                0,
                ClassName.as_ptr(),
                Title.as_ptr(),
                WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                620,
                390,
                0,
                0,
                Instance,
                StatePtr as _,
            );
            if Window == 0 {
                drop(Box::from_raw(StatePtr));
                return Err("cannot create installer window".to_string());
            }

            ShowWindow(Window, SW_SHOW);
            UpdateWindow(Window);

            let mut Message: MSG = zeroed();
            while GetMessageW(&mut Message, 0, 0, 0) > 0 {
                TranslateMessage(&Message);
                DispatchMessageW(&Message);
            }
        }

        Ok(())
    }

    unsafe extern "system" fn WindowProc(
        Window: HWND,
        Message: u32,
        WParam: WPARAM,
        LParam: LPARAM,
    ) -> LRESULT {
        match Message {
            WM_CREATE => {
                let CreateStruct =
                    LParam as *const windows_sys::Win32::UI::WindowsAndMessaging::CREATESTRUCTW;
                let StatePtr = (*CreateStruct).lpCreateParams as *mut GuiState;
                windows_sys::Win32::UI::WindowsAndMessaging::SetWindowLongPtrW(
                    Window,
                    GWLP_USERDATA,
                    StatePtr as isize,
                );
                (*StatePtr).MainWindow = Window;
                CreateControls(Window, &mut *StatePtr);
                0
            }
            WM_COMMAND => {
                let ControlId = (WParam & 0xffff) as i32;
                let State = State(Window);
                if !State.is_null() {
                    match ControlId {
                        ID_BROWSE => BrowseForInstallDir(&mut *State),
                        ID_INSTALL => StartInstall(&mut *State),
                        _ => {}
                    }
                }
                0
            }
            WM_CLOSE => {
                DestroyWindow(Window);
                0
            }
            WM_DESTROY => {
                let StatePtr = State(Window);
                if !StatePtr.is_null() {
                    let _ = Box::from_raw(StatePtr);
                    windows_sys::Win32::UI::WindowsAndMessaging::SetWindowLongPtrW(
                        Window,
                        GWLP_USERDATA,
                        0,
                    );
                }
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(Window, Message, WParam, LParam),
        }
    }

    unsafe fn CreateControls(Window: HWND, State: &mut GuiState) {
        let Font = GetStockObject(DEFAULT_GUI_FONT);
        CreateLabel(Window, "Nyx Setup", 24, 22, 540, 28, true);
        CreateLabel(
            Window,
            "Install Nyx, nyx-keyman, assets, runtime files, presets, and bundled sidecars.",
            24,
            58,
            548,
            28,
            false,
        );
        CreateLabel(Window, "Install location", 24, 102, 200, 22, false);

        State.PathEdit = CreateControl(
            "EDIT",
            &DefaultInstallDir().to_string_lossy(),
            WS_CHILD | WS_VISIBLE | WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL as u32,
            24,
            126,
            430,
            26,
            Window,
            ID_INSTALL_PATH,
        );
        State.BrowseButton = CreateControl(
            "BUTTON",
            "Browse...",
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON as u32,
            466,
            125,
            104,
            28,
            Window,
            ID_BROWSE,
        );
        State.ShortcutCheck = CreateControl(
            "BUTTON",
            "Create desktop shortcut",
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_AUTOCHECKBOX as u32,
            24,
            178,
            260,
            24,
            Window,
            ID_SHORTCUT,
        );
        State.LaunchCheck = CreateControl(
            "BUTTON",
            "Launch Nyx after install",
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_AUTOCHECKBOX as u32,
            24,
            208,
            260,
            24,
            Window,
            ID_LAUNCH,
        );
        State.DevtoolsCheck = CreateControl(
            "BUTTON",
            "Install bundled devtools module",
            WS_CHILD
                | WS_VISIBLE
                | WS_TABSTOP
                | BS_AUTOCHECKBOX as u32
                | if State.PayloadInfo.HasDevtoolsModule {
                    0
                } else {
                    WS_DISABLED
                },
            24,
            238,
            280,
            24,
            Window,
            ID_DEVTOOLS,
        );
        State.InstallButton = CreateControl(
            "BUTTON",
            "Install",
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON as u32,
            466,
            286,
            104,
            32,
            Window,
            ID_INSTALL,
        );
        State.StatusLabel = CreateControl(
            "STATIC",
            if State.PayloadInfo.HasDevtoolsModule {
                "Ready to install."
            } else {
                "Ready to install. No devtools module is bundled in this setup."
            },
            WS_CHILD | WS_VISIBLE | SS_LEFT,
            24,
            292,
            420,
            48,
            Window,
            ID_STATUS,
        );

        for Control in [
            State.PathEdit,
            State.BrowseButton,
            State.ShortcutCheck,
            State.LaunchCheck,
            State.DevtoolsCheck,
            State.InstallButton,
            State.StatusLabel,
        ] {
            SendMessageW(Control, WM_SETFONT, Font as usize, 1);
        }

        SendMessageW(State.ShortcutCheck, BM_SETCHECK, BST_CHECKED, 0);
        if State.PayloadInfo.HasDevtoolsModule {
            SendMessageW(State.DevtoolsCheck, BM_SETCHECK, BST_CHECKED, 0);
        } else {
            SendMessageW(State.DevtoolsCheck, BM_SETCHECK, BST_UNCHECKED, 0);
        }
    }

    unsafe fn CreateLabel(
        Window: HWND,
        Text: &str,
        X: i32,
        Y: i32,
        Width: i32,
        Height: i32,
        Large: bool,
    ) -> HWND {
        let Label = CreateControl(
            "STATIC",
            Text,
            WS_CHILD | WS_VISIBLE | SS_LEFT,
            X,
            Y,
            Width,
            Height,
            Window,
            0,
        );
        let Font = GetStockObject(DEFAULT_GUI_FONT);
        SendMessageW(Label, WM_SETFONT, Font as usize, 1);
        if Large {
            SetWindowTextW(Label, Wide(Text).as_ptr());
        }
        Label
    }

    unsafe fn CreateControl(
        ClassName: &str,
        Text: &str,
        Style: u32,
        X: i32,
        Y: i32,
        Width: i32,
        Height: i32,
        Parent: HWND,
        Id: i32,
    ) -> HWND {
        CreateWindowExW(
            0,
            Wide(ClassName).as_ptr(),
            Wide(Text).as_ptr(),
            Style,
            X,
            Y,
            Width,
            Height,
            Parent,
            Id as HMENU,
            GetModuleHandleW(null()),
            null_mut(),
        )
    }

    unsafe fn BrowseForInstallDir(State: &mut GuiState) {
        let Current = ReadControlText(State.PathEdit);
        let mut Dialog = rfd::FileDialog::new();
        if !Current.trim().is_empty() {
            Dialog = Dialog.set_directory(Current.trim());
        }
        if let Some(Folder) = Dialog.pick_folder() {
            SetControlText(State.PathEdit, &Folder.to_string_lossy());
        }
    }

    unsafe fn StartInstall(State: &mut GuiState) {
        let InstallPath = ReadControlText(State.PathEdit);
        let InstallPath = InstallPath.trim();
        if InstallPath.is_empty() {
            MessageBoxError("Nyx Setup", "Choose an install location first.");
            return;
        }

        let InstallDir = PathBuf::from(InstallPath);
        let Options = InstallerOptions {
            CreateDesktopShortcut: IsChecked(State.ShortcutCheck),
            LaunchAfterInstall: IsChecked(State.LaunchCheck),
            InstallDevtools: State.PayloadInfo.HasDevtoolsModule && IsChecked(State.DevtoolsCheck),
        };

        SetInstallingEnabled(State, false);
        SetStatus(State, "Installing...");

        let Result = (|| {
            fs::create_dir_all(&InstallDir)
                .map_err(|Error| format!("cannot create install dir: {Error}"))?;
            ExtractArchive(
                &State.InstallerExe,
                State.ArchiveOffset,
                &InstallDir,
                Options,
                Some(|RelativePath: &str| {
                    SetStatus(State, &format!("Installing {RelativePath}"));
                }),
            )?;
            if Options.CreateDesktopShortcut {
                CreateShortcuts(&InstallDir)?;
            }
            Ok::<(), String>(())
        })();

        match Result {
            Ok(()) => {
                SetStatus(State, "Install complete.");
                MessageBoxInfo("Nyx Setup", "Nyx installed successfully.");
                if Options.LaunchAfterInstall {
                    if let Err(Error) = LaunchNyx(&InstallDir) {
                        MessageBoxError("Nyx Setup", &Error);
                    }
                }
                DestroyWindow(State.MainWindow);
            }
            Err(Error) => {
                SetInstallingEnabled(State, true);
                SetStatus(State, "Install failed.");
                MessageBoxError("Nyx Setup", &Error);
            }
        }
    }

    unsafe fn SetInstallingEnabled(State: &GuiState, Enabled: bool) {
        let EnabledValue = if Enabled { 1 } else { 0 };
        for Control in [
            State.PathEdit,
            State.BrowseButton,
            State.ShortcutCheck,
            State.LaunchCheck,
            State.DevtoolsCheck,
            State.InstallButton,
        ] {
            EnableWindow(Control, EnabledValue);
        }
        if !State.PayloadInfo.HasDevtoolsModule {
            EnableWindow(State.DevtoolsCheck, 0);
        }
    }

    unsafe fn IsChecked(Control: HWND) -> bool {
        SendMessageW(Control, BM_GETCHECK, 0, 0) == BST_CHECKED as isize
    }

    unsafe fn ReadControlText(Control: HWND) -> String {
        let mut Buffer = vec![0u16; 1024];
        let Len = GetWindowTextW(Control, Buffer.as_mut_ptr(), Buffer.len() as i32);
        String::from_utf16_lossy(&Buffer[..Len as usize])
    }

    unsafe fn SetControlText(Control: HWND, Text: &str) {
        SetWindowTextW(Control, Wide(Text).as_ptr());
    }

    unsafe fn SetStatus(State: &GuiState, Text: &str) {
        SetControlText(State.StatusLabel, Text);
        UpdateWindow(State.MainWindow);
    }

    unsafe fn State(Window: HWND) -> *mut GuiState {
        windows_sys::Win32::UI::WindowsAndMessaging::GetWindowLongPtrW(Window, GWLP_USERDATA)
            as *mut GuiState
    }

    pub fn MessageBoxError(Title: &str, Message: &str) {
        unsafe {
            MessageBoxW(
                0,
                Wide(Message).as_ptr(),
                Wide(Title).as_ptr(),
                MB_OK | MB_ICONERROR,
            );
        }
    }

    fn MessageBoxInfo(Title: &str, Message: &str) {
        unsafe {
            MessageBoxW(
                0,
                Wide(Message).as_ptr(),
                Wide(Title).as_ptr(),
                MB_OK | MB_ICONINFORMATION,
            );
        }
    }

    fn Wide(Value: &str) -> Vec<u16> {
        Value.encode_utf16().chain(Some(0)).collect()
    }
}
