use std::io::{self, BufRead, Write};
use zeroize::Zeroize;

const KEYRING_SERVICE:   &str = "nyx-ide";
const KEYRING_ANTHROPIC: &str = "anthropic";
const KEYRING_DEEPSEEK:  &str = "deepseek";

const ACC: &str = "\x1b[38;2;212;176;204m";
const DIM: &str = "\x1b[38;2;86;80;95m";
const TXT: &str = "\x1b[38;2;237;232;240m";
const BLD: &str = "\x1b[1m";
const GRN: &str = "\x1b[38;2;100;220;130m";
const RED: &str = "\x1b[38;2;220;100;100m";
const RST: &str = "\x1b[0m";

fn enable_ansi() {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::Console::{
            GetConsoleMode, GetStdHandle, SetConsoleMode, STD_OUTPUT_HANDLE,
        };
        const ENABLE_VIRTUAL_TERMINAL_PROCESSING: u32 = 0x0004;
        let h = GetStdHandle(STD_OUTPUT_HANDLE);
        let mut mode = 0u32;
        if GetConsoleMode(h, &mut mode) != 0 {
            let _ = SetConsoleMode(h, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
        }
    }
}

fn clear_clipboard() {
    let _ = std::process::Command::new("cmd")
        .args(["/C", "echo.|clip"])
        .output();
}

fn pause() {
    print!("\n  {}Press Enter to close…{}", DIM, RST);
    let _ = io::stdout().flush();
    let _ = io::stdin().lock().lines().next();
}

fn main() {
    enable_ansi();

    println!();
    println!("  {}╭────────────────────────────────────╮{}", ACC, RST);
    println!(
        "  {}│{}  {BLD}{TXT}NYX{RST}  {DIM}·{RST}  Key Manager              {ACC}│{RST}",
        ACC, RST,
        BLD = BLD, TXT = TXT, RST = RST, DIM = DIM, ACC = ACC
    );
    println!("  {}╰────────────────────────────────────╯{}", ACC, RST);
    println!();
    println!("  {}Stored in Windows Credential Manager.", DIM);
    println!("  {}The key never touches the Nyx process.{}", DIM, RST);
    println!();

    println!("  {}Select provider:{}", TXT, RST);
    println!();
    println!("  {}1{}  ·  Anthropic", ACC, RST);
    println!("  {}2{}  ·  DeepSeek", ACC, RST);
    println!();
    print!("  {}>{} ", ACC, RST);
    let _ = io::stdout().flush();

    let choice = io::stdin().lock().lines().next()
        .and_then(|l| l.ok())
        .unwrap_or_default();
    let choice = choice.trim().to_string();

    let (account, label) = match choice.as_str() {
        "1" => (KEYRING_ANTHROPIC, "Anthropic"),
        "2" => (KEYRING_DEEPSEEK,  "DeepSeek"),
        _ => {
            println!("\n  {}Invalid selection. Enter 1 or 2.{}", RED, RST);
            pause();
            return;
        }
    };

    println!();
    println!("  {}Paste your {} API key and press Enter:{}", TXT, label, RST);
    println!("  {}Input is hidden  ·  clipboard is cleared after{}", DIM, RST);
    println!();
    print!("  {}>{} ", ACC, RST);
    let _ = io::stdout().flush();

    let mut raw = rpassword::read_password().unwrap_or_default();
    let mut key = raw.trim().to_string();
    raw.zeroize();

    if key.is_empty() {
        println!("\n  {}No key entered. Nothing was stored.{}", DIM, RST);
        pause();
        return;
    }

    let result = keyring::Entry::new(KEYRING_SERVICE, account)
        .map_err(|e| e.to_string())
        .and_then(|entry| entry.set_password(&key).map_err(|e| e.to_string()));

    key.zeroize();
    clear_clipboard();

    match result {
        Ok(_) => {
            println!();
            println!("  {}✓{}  {} key stored.", GRN, RST, label);
            println!("  {}   Clipboard cleared.{}", DIM, RST);
        }
        Err(e) => {
            println!("\n  {}Error: {}{}", RED, e, RST);
        }
    }

    pause();
}
