use std::{
    collections::BTreeMap,
    env,
    io::{self, IsTerminal, Write},
    path::PathBuf,
    time::Duration,
};

use crossterm::{
    cursor::{MoveTo, MoveToColumn, MoveUp},
    event::{self, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute,
    style::{Attribute, Color as TermColor, Print, ResetColor, SetAttribute, SetForegroundColor},
    terminal::{disable_raw_mode, enable_raw_mode, Clear, ClearType},
};
use futures_util::StreamExt;
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, Paragraph, Wrap},
    Terminal,
};
use serde::Deserialize;
use serde_json::{json, Value};
use zeroize::Zeroizing;

#[allow(dead_code)]
#[path = "../../commands/agent.rs"]
mod agent;
#[allow(dead_code)]
#[path = "../../agent_runtime/mod.rs"]
mod agent_runtime;
#[allow(dead_code)]
#[path = "../../skills/mod.rs"]
mod skills;

const KEYRING_SERVICE: &str = "nyx-ide";
const KEYRING_ANTHROPIC: &str = "anthropic";
const KEYRING_DEEPSEEK: &str = "deepseek";
const KEYRING_OPENAI: &str = "openai";

#[derive(Clone)]
struct CliOptions {
    workspace: Option<String>,
    provider: String,
    mode: String,
    context_limit: Option<String>,
    initial_prompt: Option<String>,
}

#[derive(Default, Deserialize)]
struct AppSettings {
    #[serde(default = "DefaultProvider")]
    DefaultProvider: String,
    #[serde(default)]
    obsidian_vault_path: Option<String>,
    #[serde(default = "DefaultAiMode")]
    ai_mode: String,
}

#[derive(Default)]
struct AnthropicBlock {
    id: String,
    name: String,
    input_json: String,
}

#[derive(Default)]
struct OpenAiToolAccumulator {
    id: String,
    name: String,
    arguments: String,
}

struct CliHeader {
    provider: String,
    model: String,
    mode: String,
    workspace: Option<String>,
    top_up: String,
    context_limit: String,
    activity: String,
}

#[derive(Clone, Copy)]
struct CommandSuggestion {
    command: &'static str,
    description: &'static str,
}

const COMMANDS: &[CommandSuggestion] = &[
    CommandSuggestion {
        command: "/clear",
        description: "Clear conversation history",
    },
    CommandSuggestion {
        command: "/help",
        description: "Show available commands",
    },
    CommandSuggestion {
        command: "/exit",
        description: "Quit NyxCli",
    },
    CommandSuggestion {
        command: "/quit",
        description: "Quit NyxCli",
    },
];

const ASSISTANT_RENDER_LINE_LIMIT: usize = 48;
const TOOL_RESULT_LINE_LIMIT: usize = 18;
const CHANGE_PREVIEW_LINE_LIMIT: usize = 24;

fn DefaultProvider() -> String {
    "anthropic".to_string()
}
fn DefaultAiMode() -> String {
    "supervised".to_string()
}

fn main() {
    if let Err(error) = run() {
        eprintln!("NyxCli: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("Could not start async runtime: {error}"))?;

    runtime.block_on(AsyncMain())
}

async fn AsyncMain() -> Result<(), String> {
    let settings = LoadAppSettings();
    let options = ParseArgs(&settings)?;

    let (model, _) = ProviderModel(&options.provider)?;
    let ApiKey = ProviderKey(&options.provider);
    let ToolSettings = BuildToolSettings(&settings, options.workspace.clone())?;
    let mode = agent::AgentMode::FromStr(&options.mode);
    let system =
        agent::BuildSystemPrompt(options.workspace.as_deref(), &mode, &[], &options.provider);
    let mut messages: Vec<Value> = Vec::new();

    let mut header = CliHeader {
        provider: options.provider.clone(),
        model: model.clone(),
        mode: options.mode.clone(),
        workspace: options.workspace.clone(),
        top_up: "checking".to_string(),
        context_limit: options
            .context_limit
            .clone()
            .unwrap_or_else(|| "not set".to_string()),
        activity: "Starting NyxCli".to_string(),
    };
    header.top_up = if let Some(key) = ApiKey.as_ref() {
        AnimateBalanceHeader(&mut header, &options.provider, key.as_str()).await
    } else {
        "key missing".to_string()
    };
    header.activity = "Ready. Type a prompt below.".to_string();
    RenderHeader(&header);

    if let Some(prompt) = options.initial_prompt {
        if let Some(key) = ApiKey.as_ref() {
            RunPrompt(
                &mut messages,
                prompt,
                &system,
                key.as_str(),
                &model,
                &options.provider,
                &ToolSettings,
                &mode,
            )
            .await?;
        } else {
            return Err(MissingKeyMessage(&options.provider));
        }
    }

    loop {
        let Some(input) = ReadNextInput()? else {
            break;
        };
        let prompt = input.trim();
        if prompt.is_empty() {
            continue;
        }
        if matches!(prompt, "/exit" | "/quit") {
            break;
        }
        if prompt == "/clear" {
            messages.clear();
            RenderNotice("Conversation cleared.");
            continue;
        }
        if prompt == "/help" {
            RenderCommandHelp();
            continue;
        }

        let Some(key) = ApiKey.as_ref() else {
            println!("{}", MissingKeyMessage(&options.provider));
            continue;
        };

        RunPrompt(
            &mut messages,
            prompt.to_string(),
            &system,
            key.as_str(),
            &model,
            &options.provider,
            &ToolSettings,
            &mode,
        )
        .await?;
    }

    Ok(())
}

fn ParseArgs(settings: &AppSettings) -> Result<CliOptions, String> {
    let mut workspace: Option<String> = None;
    let mut provider = settings.DefaultProvider.clone();
    let mut mode = settings.ai_mode.clone();
    let mut ContextLimit = env::var("NYX_CONTEXT_LIMIT")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let mut PromptParts: Vec<String> = Vec::new();

    let mut args = env::args().skip(1).peekable();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--help" | "-h" => {
                PrintHelp();
                std::process::exit(0);
            }
            "--workspace" | "-w" => {
                workspace = Some(args.next().ok_or("Missing value for --workspace")?);
            }
            "--provider" | "-p" => {
                provider = args.next().ok_or("Missing value for --provider")?;
            }
            "--mode" | "-m" => {
                mode = args.next().ok_or("Missing value for --mode")?;
            }
            "--context-limit" => {
                ContextLimit = Some(args.next().ok_or("Missing value for --context-limit")?);
            }
            _ if arg.starts_with("--workspace=") => {
                workspace = Some(arg.trim_start_matches("--workspace=").to_string());
            }
            _ if arg.starts_with("--provider=") => {
                provider = arg.trim_start_matches("--provider=").to_string();
            }
            _ if arg.starts_with("--mode=") => {
                mode = arg.trim_start_matches("--mode=").to_string();
            }
            _ if arg.starts_with("--context-limit=") => {
                ContextLimit = Some(arg.trim_start_matches("--context-limit=").to_string());
            }
            _ => PromptParts.push(arg),
        }
    }

    if !matches!(provider.as_str(), "anthropic" | "deepseek" | "openai") {
        return Err(format!(
            "Unknown provider '{provider}'. Use anthropic, deepseek, or openai."
        ));
    }
    if mode != "supervised" && mode != "autonomous" && mode != "agentic" {
        return Err(format!(
            "Unknown mode '{mode}'. Use supervised, autonomous, or agentic."
        ));
    }

    let InitialPrompt = if PromptParts.is_empty() {
        None
    } else {
        Some(PromptParts.join(" "))
    };

    Ok(CliOptions {
        workspace,
        provider,
        mode,
        context_limit: ContextLimit,
        initial_prompt: InitialPrompt,
    })
}

fn PrintHelp() {
    println!("NyxCli");
    println!();
    println!("Usage:");
    println!("  NyxCli [--workspace PATH] [--provider anthropic|deepseek|openai] [--mode supervised|autonomous|agentic] [--context-limit TOKENS] [prompt]");
    println!();
    println!("Commands:");
    for command in COMMANDS {
        println!("  {:<8} {}", command.command, command.description);
    }
}

struct RawModeGuard;

impl RawModeGuard {
    fn new() -> Result<Self, String> {
        enable_raw_mode().map_err(|error| error.to_string())?;
        Ok(Self)
    }
}

impl Drop for RawModeGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
    }
}

fn ReadNextInput() -> Result<Option<String>, String> {
    if io::stdin().is_terminal() {
        return ReadPrompt();
    }

    print!("\n> ");
    io::stdout().flush().map_err(|error| error.to_string())?;
    let mut input = String::new();
    let read = io::stdin()
        .read_line(&mut input)
        .map_err(|error| error.to_string())?;
    if read == 0 {
        Ok(None)
    } else {
        Ok(Some(input.trim_end_matches(['\r', '\n']).to_string()))
    }
}

fn ReadPrompt() -> Result<Option<String>, String> {
    let _raw = RawModeGuard::new()?;
    let mut input = String::new();
    let mut selected = 0usize;
    let mut RenderedLines = 0u16;

    RenderPromptInput(&input, selected, &mut RenderedLines)?;

    loop {
        let Event::Key(key) = event::read().map_err(|error| error.to_string())? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }

        match key.code {
            KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                CleanupPromptRender(RenderedLines)?;
                drop(_raw);
                println!();
                return Ok(None);
            }
            KeyCode::Enter => {
                CleanupPromptRender(RenderedLines)?;
                drop(_raw);
                println!("> {}", input);
                return Ok(Some(input));
            }
            KeyCode::Esc => {
                input.clear();
                selected = 0;
            }
            KeyCode::Backspace => {
                input.pop();
                selected = 0;
            }
            KeyCode::Char(ch)
                if key.modifiers.is_empty() || key.modifiers == KeyModifiers::SHIFT =>
            {
                input.push(ch);
                selected = 0;
            }
            KeyCode::Tab => {
                let suggestions = CommandSuggestions(&input);
                if let Some(suggestion) = suggestions.get(selected) {
                    input = suggestion.command.to_string();
                    selected = 0;
                }
            }
            KeyCode::Up => {
                let count = CommandSuggestions(&input).len();
                if count > 0 {
                    selected = if selected == 0 {
                        count - 1
                    } else {
                        selected - 1
                    };
                }
            }
            KeyCode::Down => {
                let count = CommandSuggestions(&input).len();
                if count > 0 {
                    selected = (selected + 1) % count;
                }
            }
            _ => {}
        }

        let count = CommandSuggestions(&input).len();
        if count == 0 {
            selected = 0;
        } else if selected >= count {
            selected = count - 1;
        }
        RenderPromptInput(&input, selected, &mut RenderedLines)?;
    }
}

fn CommandSuggestions(input: &str) -> Vec<CommandSuggestion> {
    let trimmed = input.trim_start();
    if !trimmed.starts_with('/') {
        return Vec::new();
    }
    COMMANDS
        .iter()
        .copied()
        .filter(|command| command.command.starts_with(trimmed))
        .take(5)
        .collect()
}

fn CleanupPromptRender(RenderedLines: u16) -> Result<(), String> {
    let mut stdout = io::stdout();
    if RenderedLines > 1 {
        execute!(stdout, MoveUp(RenderedLines - 1)).map_err(|error| error.to_string())?;
    }
    execute!(stdout, MoveToColumn(0), Clear(ClearType::FromCursorDown))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn RenderPromptInput(input: &str, selected: usize, RenderedLines: &mut u16) -> Result<(), String> {
    let mut stdout = io::stdout();
    if *RenderedLines > 1 {
        execute!(stdout, MoveUp(*RenderedLines - 1)).map_err(|error| error.to_string())?;
    }
    execute!(stdout, MoveToColumn(0), Clear(ClearType::FromCursorDown))
        .map_err(|error| error.to_string())?;

    execute!(
        stdout,
        SetForegroundColor(TermColor::Rgb {
            r: 212,
            g: 176,
            b: 204,
        }),
        Print("> "),
        ResetColor,
        Print(input)
    )
    .map_err(|error| error.to_string())?;

    let suggestions = CommandSuggestions(input);
    let mut lines = 1u16;
    if !suggestions.is_empty() {
        println!();
        lines += 1;
        execute!(
            stdout,
            SetForegroundColor(TermColor::Rgb {
                r: 136,
                g: 128,
                b: 148,
            }),
            Print("  commands"),
            ResetColor
        )
        .map_err(|error| error.to_string())?;
        for (index, suggestion) in suggestions.iter().enumerate() {
            println!();
            lines += 1;
            let active = index == selected;
            execute!(
                stdout,
                SetForegroundColor(if active {
                    TermColor::Rgb {
                        r: 212,
                        g: 184,
                        b: 122,
                    }
                } else {
                    TermColor::Rgb {
                        r: 180,
                        g: 174,
                        b: 188,
                    }
                }),
                Print(if active { "  > " } else { "    " }),
                SetAttribute(if active {
                    Attribute::Bold
                } else {
                    Attribute::Reset
                }),
                Print(format!("{:<8}", suggestion.command)),
                SetAttribute(Attribute::Reset),
                SetForegroundColor(TermColor::Rgb {
                    r: 136,
                    g: 128,
                    b: 148,
                }),
                Print(format!(" {}", suggestion.description)),
                ResetColor
            )
            .map_err(|error| error.to_string())?;
        }
        if !suggestions.is_empty() {
            println!();
            lines += 1;
            execute!(
                stdout,
                SetForegroundColor(TermColor::Rgb {
                    r: 86,
                    g: 80,
                    b: 95,
                }),
                Print("  Tab completes, Up/Down selects"),
                ResetColor
            )
            .map_err(|error| error.to_string())?;
        }
    }

    if lines > 1 {
        execute!(
            stdout,
            MoveUp(lines - 1),
            MoveToColumn(2 + input.chars().count() as u16)
        )
        .map_err(|error| error.to_string())?;
    }
    stdout.flush().map_err(|error| error.to_string())?;
    *RenderedLines = lines;
    Ok(())
}

async fn FetchTopUpStatus(provider: &str, ApiKey: &str) -> String {
    match provider {
        "deepseek" => FetchDeepseekBalance(ApiKey).await,
        "anthropic" => "Console billing page".to_string(),
        "openai" => "platform.openai.com/usage".to_string(),
        _ => "unavailable".to_string(),
    }
}

async fn FetchDeepseekBalance(ApiKey: &str) -> String {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
    {
        Ok(client) => client,
        Err(_) => return "unavailable".to_string(),
    };

    let response = match client
        .get("https://api.deepseek.com/user/balance")
        .bearer_auth(ApiKey)
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return "unavailable".to_string(),
    };

    if !response.status().is_success() {
        return format!("unavailable ({})", response.status());
    }

    let body: Value = match response.json().await {
        Ok(body) => body,
        Err(_) => return "unavailable".to_string(),
    };

    let available = body
        .get("is_available")
        .and_then(Value::as_bool)
        .map(|value| if value { "available" } else { "low" })
        .unwrap_or("unknown");

    let Some(info) = body
        .get("balance_infos")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("currency").and_then(Value::as_str) == Some("USD"))
                .or_else(|| items.first())
        })
    else {
        return format!("balance {available}");
    };

    let currency = info.get("currency").and_then(Value::as_str).unwrap_or("");
    let ToppedUp = info
        .get("topped_up_balance")
        .and_then(Value::as_str)
        .unwrap_or("?");
    let total = info
        .get("total_balance")
        .and_then(Value::as_str)
        .unwrap_or("?");

    format!("{currency} {ToppedUp} top-up | {total} total | {available}")
}

async fn AnimateBalanceHeader(header: &mut CliHeader, provider: &str, ApiKey: &str) -> String {
    let mut balance = Box::pin(FetchTopUpStatus(provider, ApiKey));
    let frames = ["-", "\\", "|", "/"];
    let mut frame = 0usize;

    loop {
        header.top_up = format!("checking {}", frames[frame % frames.len()]);
        header.activity = format!("Checking API status {}", frames[frame % frames.len()]);
        RenderHeader(header);

        tokio::select! {
            status = &mut balance => return status,
            _ = tokio::time::sleep(Duration::from_millis(110)) => {
                frame = frame.wrapping_add(1);
            }
        }
    }
}

fn RenderHeader(header: &CliHeader) {
    if !io::stdout().is_terminal() {
        RenderHeaderPlain(header);
        return;
    }
    if RenderHeaderTui(header).is_err() {
        RenderHeaderPlain(header);
    }
}

fn RenderHeaderTui(header: &CliHeader) -> Result<(), String> {
    let mut stdout = io::stdout();
    execute!(stdout, Clear(ClearType::All), MoveTo(0, 0)).map_err(|error| error.to_string())?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).map_err(|error| error.to_string())?;
    terminal
        .draw(|frame| {
            let full = frame.area();
            let width = full.width.clamp(72, 112);
            let height = full.height.clamp(11, 15);
            let area = Rect {
                x: full.x + full.width.saturating_sub(width) / 2,
                y: full.y,
                width,
                height,
            };

            let rows = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Length(height.saturating_sub(3)),
                    Constraint::Length(3),
                ])
                .split(area);

            let columns = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
                .split(rows[0]);

            let session = Paragraph::new(SessionPanelLines(header))
                .block(
                    Block::default()
                        .title(Line::from(vec![
                            Span::styled(
                                " NyxCli ",
                                Style::default()
                                    .fg(Color::Rgb(212, 176, 204))
                                    .add_modifier(Modifier::BOLD),
                            ),
                            Span::styled(
                                "Session ",
                                Style::default().fg(Color::Rgb(136, 128, 148)),
                            ),
                        ]))
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(Color::Rgb(212, 176, 204))),
                )
                .wrap(Wrap { trim: true });

            let welcome = Paragraph::new(WelcomePanelLines(header))
                .block(
                    Block::default()
                        .title(Line::from(Span::styled(
                            " Welcome ",
                            Style::default()
                                .fg(Color::Rgb(138, 199, 232))
                                .add_modifier(Modifier::BOLD),
                        )))
                        .borders(Borders::ALL)
                        .border_type(BorderType::Rounded)
                        .border_style(Style::default().fg(Color::Rgb(138, 199, 232))),
                )
                .wrap(Wrap { trim: true });

            let activity = Paragraph::new(Line::from(vec![
                Span::styled("  ", Style::default().bg(Color::Rgb(212, 176, 204))),
                Span::raw("  "),
                Span::styled(
                    header.activity.as_str(),
                    Style::default()
                        .fg(Color::Rgb(237, 232, 240))
                        .add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    "  /clear resets chat  /exit closes",
                    Style::default().fg(Color::Rgb(136, 128, 148)),
                ),
            ]))
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .border_type(BorderType::Rounded)
                    .border_style(Style::default().fg(Color::Rgb(86, 80, 95))),
            );

            frame.render_widget(session, columns[0]);
            frame.render_widget(welcome, columns[1]);
            frame.render_widget(activity, rows[1]);
        })
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn SessionPanelLines(header: &CliHeader) -> Vec<Line<'static>> {
    let workspace = header.workspace.as_deref().unwrap_or("none");

    vec![
        InfoLine("Model", &header.model, Color::Rgb(212, 176, 204)),
        InfoLine("Provider", &header.provider, Color::Rgb(138, 199, 232)),
        InfoLine("Mode", &header.mode, Color::Rgb(212, 184, 122)),
        InfoLine("API top-up", &header.top_up, Color::Rgb(142, 230, 164)),
        InfoLine("Context", &header.context_limit, Color::Rgb(237, 232, 240)),
        InfoLine("Workspace", workspace, Color::Rgb(180, 174, 188)),
    ]
}

fn WelcomePanelLines(header: &CliHeader) -> Vec<Line<'static>> {
    let ModeHint = match header.mode.as_str() {
        "autonomous" => "Autonomous mode executes allowed tools directly.",
        "agentic" => "Agentic mode uses sliced autonomous work with memory checkpoints.",
        _ => "Supervised mode asks before writes/commands.",
    };

    vec![
        Line::from(Span::styled(
            "Welcome to NyxCli",
            Style::default()
                .fg(Color::Rgb(237, 232, 240))
                .add_modifier(Modifier::BOLD),
        )),
        Line::from(Span::styled(
            "Full terminal window for Nyx.",
            Style::default().fg(Color::Rgb(180, 174, 188)),
        )),
        Line::from(Span::styled(
            "Same tools, memory, keys, and workspace context.",
            Style::default().fg(Color::Rgb(180, 174, 188)),
        )),
        Line::from(""),
        Line::from(vec![
            Span::styled(">", Style::default().fg(Color::Rgb(212, 176, 204))),
            Span::raw(" Ask for code, scenes, notes, or shell work."),
        ]),
        Line::from(vec![
            Span::styled(">", Style::default().fg(Color::Rgb(212, 176, 204))),
            Span::raw(format!(" {ModeHint}")),
        ]),
    ]
}

fn InfoLine(label: &str, value: &str, color: Color) -> Line<'static> {
    Line::from(vec![
        Span::styled(
            format!("{label:<12}"),
            Style::default().fg(Color::Rgb(136, 128, 148)),
        ),
        Span::styled(
            FitLine(value, 56),
            Style::default().fg(color).add_modifier(Modifier::BOLD),
        ),
    ])
}

fn RenderHeaderPlain(header: &CliHeader) {
    const WIDTH: usize = 100;
    const LEFT_WIDTH: usize = 47;
    const RIGHT_WIDTH: usize = 48;

    let workspace = header.workspace.as_deref().unwrap_or("none");
    let left = [
        format!("Model: {}", header.model),
        format!("Provider: {}", header.provider),
        format!("Mode: {}", header.mode),
        format!("API top-up: {}", header.top_up),
        format!("Context limit: {}", header.context_limit),
        format!("Workspace: {}", workspace),
    ];
    let right = [
        "Welcome to NyxCli".to_string(),
        "A full terminal window for Nyx AI.".to_string(),
        "Same workspace tools as the IDE panel.".to_string(),
        "Use /clear to reset the chat.".to_string(),
        "Use /exit to close the session.".to_string(),
        "Ready for code, scenes, and notes.".to_string(),
    ];

    println!();
    println!("╭{}┬{}╮", "─".repeat(LEFT_WIDTH), "─".repeat(RIGHT_WIDTH));
    println!(
        "│{}│{}│",
        FitCell("Session", LEFT_WIDTH),
        FitCell("NyxCli", RIGHT_WIDTH)
    );
    println!("├{}┼{}┤", "─".repeat(LEFT_WIDTH), "─".repeat(RIGHT_WIDTH));
    for index in 0..left.len().max(right.len()) {
        println!(
            "│{}│{}│",
            FitCell(
                left.get(index).map(String::as_str).unwrap_or(""),
                LEFT_WIDTH
            ),
            FitCell(
                right.get(index).map(String::as_str).unwrap_or(""),
                RIGHT_WIDTH
            )
        );
    }
    println!("╰{}┴{}╯", "─".repeat(LEFT_WIDTH), "─".repeat(RIGHT_WIDTH));
    println!("{}", FitLine(&header.activity, WIDTH + 3));
}

fn FitCell(value: &str, width: usize) -> String {
    let mut Text = value.replace('\n', " ");
    if Text.chars().count() > width.saturating_sub(2) {
        Text = TruncateChars(&Text, width.saturating_sub(5));
        Text.push_str("...");
    }
    format!(" {:<width$}", Text, width = width - 1)
}

fn FitLine(value: &str, width: usize) -> String {
    if value.chars().count() <= width {
        value.to_string()
    } else {
        let mut Text = TruncateChars(value, width.saturating_sub(3));
        Text.push_str("...");
        Text
    }
}

fn TruncateChars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn SettingsPath() -> Option<PathBuf> {
    env::var("APPDATA")
        .ok()
        .map(|AppData| PathBuf::from(AppData).join("Nyx").join("settings.json"))
}

fn LoadAppSettings() -> AppSettings {
    SettingsPath()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|Text| serde_json::from_str(&Text).ok())
        .unwrap_or_default()
}

fn ProviderModel(provider: &str) -> Result<(String, bool), String> {
    match provider {
        "anthropic" => Ok(("claude-sonnet-4-6".to_string(), true)),
        "deepseek" => Ok(("deepseek-chat".to_string(), false)),
        "openai" => Ok(("gpt-4o".to_string(), false)),
        _ => Err(format!("Unknown provider: {provider}")),
    }
}

fn ProviderKey(provider: &str) -> Option<Zeroizing<String>> {
    match provider {
        "anthropic" => GetKeyringPassword(KEYRING_ANTHROPIC),
        "deepseek" => GetKeyringPassword(KEYRING_DEEPSEEK),
        "openai" => GetKeyringPassword(KEYRING_OPENAI),
        _ => None,
    }
}

fn MissingKeyMessage(provider: &str) -> String {
    match provider {
        "anthropic" => {
            "Anthropic API key is not configured. Configure it in Nyx settings.".to_string()
        }
        "deepseek" => {
            "DeepSeek API key is not configured. Configure it in Nyx settings.".to_string()
        }
        "openai" => "OpenAI API key is not configured. Configure it in Nyx settings.".to_string(),
        _ => format!("{provider} API key is not configured."),
    }
}

fn GetKeyringPassword(account: &str) -> Option<Zeroizing<String>> {
    keyring::Entry::new(KEYRING_SERVICE, account)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .map(Zeroizing::new)
}

fn BuildToolSettings(
    settings: &AppSettings,
    workspace: Option<String>,
) -> Result<agent::ToolSettings, String> {
    let AppData = env::var("APPDATA").map_err(|_| "Cannot determine AppData path".to_string())?;
    let GlobalMemory = PathBuf::from(AppData).join("Nyx").join("NyxMemory");
    let ProjectMemory = workspace
        .as_ref()
        .map(|path| PathBuf::from(path).join(".nyx").join("memory"));

    Ok(agent::ToolSettings {
        workspace_path: workspace,
        obsidian_vault_path: settings.obsidian_vault_path.clone(),
        global_memory_path: GlobalMemory,
        project_memory_path: ProjectMemory,
    })
}

struct MarkdownStreamRenderer {
    pending: String,
    in_code: bool,
    code_lang: String,
    rendered_lines: usize,
    omitted_lines: usize,
    max_lines: usize,
}

impl MarkdownStreamRenderer {
    fn new() -> Self {
        Self::WithLimit(ASSISTANT_RENDER_LINE_LIMIT)
    }

    fn WithLimit(max_lines: usize) -> Self {
        Self {
            pending: String::new(),
            in_code: false,
            code_lang: String::new(),
            rendered_lines: 0,
            omitted_lines: 0,
            max_lines,
        }
    }

    fn push(&mut self, Text: &str) -> Result<(), String> {
        self.pending.push_str(Text);
        while let Some(pos) = self.pending.find('\n') {
            let line = self.pending[..pos].to_string();
            self.pending = self.pending[(pos + 1)..].to_string();
            self.RenderLine(&line)?;
        }
        Ok(())
    }

    fn finish(&mut self) -> Result<(), String> {
        if !self.pending.is_empty() {
            let line = std::mem::take(&mut self.pending);
            self.RenderLine(&line)?;
        }
        if self.in_code {
            RenderCodeBorder(false, &self.code_lang)?;
            self.in_code = false;
        }
        if self.omitted_lines > 0 {
            RenderOmittedLines(self.omitted_lines)?;
        }
        Ok(())
    }

    fn RenderLine(&mut self, line: &str) -> Result<(), String> {
        if self.rendered_lines >= self.max_lines {
            self.omitted_lines += 1;
            return Ok(());
        }

        let trimmed = line.trim();
        if let Some(lang) = trimmed.strip_prefix("```") {
            if self.in_code {
                RenderCodeBorder(false, &self.code_lang)?;
                self.in_code = false;
                self.code_lang.clear();
            } else {
                self.in_code = true;
                self.code_lang = lang.trim().to_string();
                RenderCodeBorder(true, &self.code_lang)?;
            }
            self.rendered_lines += 1;
            return Ok(());
        }

        if self.in_code {
            RenderCodeLine(line)?;
        } else {
            RenderTextLine(line)?;
        }
        self.rendered_lines += 1;
        Ok(())
    }
}

fn RenderSection(title: &str, color: TermColor) -> Result<(), String> {
    let mut stdout = io::stdout();
    execute!(
        stdout,
        SetForegroundColor(color),
        SetAttribute(Attribute::Bold),
        Print(format!("\n\n== {title} ")),
        SetAttribute(Attribute::Reset),
        SetForegroundColor(TermColor::Rgb {
            r: 86,
            g: 80,
            b: 95,
        }),
        Print("=".repeat(72usize.saturating_sub(title.len()).max(8))),
        ResetColor,
        Print("\n")
    )
    .map_err(|error| error.to_string())
}

fn RenderNotice(Text: &str) {
    let _ = RenderSection(
        "Notice",
        TermColor::Rgb {
            r: 142,
            g: 230,
            b: 164,
        },
    );
    let _ = RenderTextLine(Text);
}

fn RenderOmittedLines(count: usize) -> Result<(), String> {
    StyledPrintln(
        &format!("[+{count} more lines]"),
        TermColor::Rgb {
            r: 136,
            g: 128,
            b: 148,
        },
        true,
    )
}

fn RenderCommandHelp() {
    let _ = RenderSection(
        "Commands",
        TermColor::Rgb {
            r: 212,
            g: 184,
            b: 122,
        },
    );
    for command in COMMANDS {
        let _ = StyledPrint(
            format!("  {:<8}", command.command).as_str(),
            TermColor::Rgb {
                r: 212,
                g: 176,
                b: 204,
            },
            true,
        );
        let _ = StyledPrintln(
            command.description,
            TermColor::Rgb {
                r: 180,
                g: 174,
                b: 188,
            },
            false,
        );
    }
}

fn RenderTextLine(line: &str) -> Result<(), String> {
    if line.trim().is_empty() {
        println!();
        return Ok(());
    }

    let trimmed = line.trim_start();
    if trimmed.starts_with('#') {
        StyledPrintln(
            trimmed.trim_start_matches('#').trim(),
            TermColor::Rgb {
                r: 212,
                g: 176,
                b: 204,
            },
            true,
        )?;
        return Ok(());
    }

    if let Some(rest) = trimmed
        .strip_prefix("- ")
        .or_else(|| trimmed.strip_prefix("* "))
    {
        for (index, wrapped) in WrapWords(rest, 92).iter().enumerate() {
            if index == 0 {
                StyledPrint(
                    "  * ",
                    TermColor::Rgb {
                        r: 212,
                        g: 184,
                        b: 122,
                    },
                    true,
                )?;
            } else {
                print!("    ");
            }
            StyledPrintln(
                wrapped,
                TermColor::Rgb {
                    r: 237,
                    g: 232,
                    b: 240,
                },
                false,
            )?;
        }
        return Ok(());
    }

    for wrapped in WrapWords(trimmed, 96) {
        StyledPrintln(
            &wrapped,
            TermColor::Rgb {
                r: 237,
                g: 232,
                b: 240,
            },
            false,
        )?;
    }
    Ok(())
}

fn RenderCodeBorder(open: bool, lang: &str) -> Result<(), String> {
    let label = if open {
        if lang.is_empty() {
            " code ".to_string()
        } else {
            format!(" {lang} ")
        }
    } else {
        String::new()
    };
    let width = 92usize;
    let fill = width.saturating_sub(label.len());
    let border = if open {
        format!("╭{label}{}╮", "─".repeat(fill))
    } else {
        format!("╰{}╯", "─".repeat(width))
    };
    StyledPrintln(
        &border,
        TermColor::Rgb {
            r: 86,
            g: 80,
            b: 95,
        },
        false,
    )
}

fn RenderCodeLine(line: &str) -> Result<(), String> {
    StyledPrint(
        "│ ",
        TermColor::Rgb {
            r: 86,
            g: 80,
            b: 95,
        },
        false,
    )?;
    if line.trim_start().starts_with("//")
        || line.trim_start().starts_with("--")
        || line.trim_start().starts_with('#')
    {
        StyledPrintln(
            line,
            TermColor::Rgb {
                r: 142,
                g: 230,
                b: 164,
            },
            false,
        )?;
        return Ok(());
    }

    for token in SplitCodeTokens(line) {
        let (color, bold) = CodeTokenStyle(&token);
        StyledPrint(&token, color, bold)?;
    }
    println!();
    Ok(())
}

fn SplitCodeTokens(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut CurrentKind: Option<bool> = None;
    for ch in line.chars() {
        let IsWord = ch.is_alphanumeric() || ch == '_';
        match CurrentKind {
            Some(kind) if kind == IsWord => current.push(ch),
            Some(_) => {
                tokens.push(std::mem::take(&mut current));
                current.push(ch);
                CurrentKind = Some(IsWord);
            }
            None => {
                current.push(ch);
                CurrentKind = Some(IsWord);
            }
        }
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

fn CodeTokenStyle(token: &str) -> (TermColor, bool) {
    let keyword = matches!(
        token,
        "fn" | "let"
            | "const"
            | "mut"
            | "pub"
            | "use"
            | "struct"
            | "enum"
            | "impl"
            | "return"
            | "if"
            | "else"
            | "match"
            | "for"
            | "while"
            | "function"
            | "local"
            | "class"
            | "interface"
            | "type"
            | "import"
            | "export"
            | "from"
            | "async"
            | "await"
    );
    if keyword {
        (
            TermColor::Rgb {
                r: 212,
                g: 176,
                b: 204,
            },
            true,
        )
    } else if token.starts_with('"') || token.starts_with('\'') {
        (
            TermColor::Rgb {
                r: 212,
                g: 184,
                b: 122,
            },
            false,
        )
    } else {
        (
            TermColor::Rgb {
                r: 237,
                g: 232,
                b: 240,
            },
            false,
        )
    }
}

fn WrapWords(text: &str, width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in text.split_whitespace() {
        let next_len = if current.is_empty() {
            word.len()
        } else {
            current.len() + 1 + word.len()
        };
        if next_len > width && !current.is_empty() {
            lines.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn StyledPrint(text: &str, color: TermColor, bold: bool) -> Result<(), String> {
    let mut stdout = io::stdout();
    if bold {
        execute!(stdout, SetAttribute(Attribute::Bold)).map_err(|error| error.to_string())?;
    }
    execute!(stdout, SetForegroundColor(color), Print(text), ResetColor)
        .map_err(|error| error.to_string())?;
    if bold {
        execute!(stdout, SetAttribute(Attribute::Reset)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn StyledPrintln(text: &str, color: TermColor, bold: bool) -> Result<(), String> {
    StyledPrint(text, color, bold)?;
    println!();
    Ok(())
}

async fn RunPrompt(
    messages: &mut Vec<Value>,
    prompt: String,
    system: &str,
    ApiKey: &str,
    model: &str,
    provider: &str,
    tool_settings: &agent::ToolSettings,
    mode: &agent::AgentMode,
) -> Result<(), String> {
    let is_anthropic = provider == "anthropic";
    messages.push(json!({ "role": "user", "content": prompt }));
    AnimateStatus("Thinking", 5)?;

    let MaxIterations = mode.MaxIterations();
    let mut turns_since_checkpoint = 0usize;

    for _ in 0..MaxIterations {
        PrintActivity("Thinking");
        RenderSection(
            "Assistant",
            TermColor::Rgb {
                r: 138,
                g: 199,
                b: 232,
            },
        )?;
        let (tool_calls, assistant_message) = if is_anthropic {
            StreamAnthropic(ApiKey, model, messages, system).await?
        } else if provider == "openai" {
            StreamOpenai(ApiKey, model, messages).await?
        } else {
            StreamDeepseek(ApiKey, model, messages).await?
        };
        messages.push(assistant_message);

        if tool_calls.is_empty() {
            println!();
            return Ok(());
        }

        let mut results: Vec<(String, String, bool)> = Vec::new();
        let mut checkpoint_saved = false;
        for tool_call in tool_calls {
            if agent::IsQuestionTool(&tool_call.name) {
                let request = agent::NormalizeQuestionRequest(&tool_call)?;
                let response = PromptQuestionRequest(&request)?;
                let display = agent::QuestionResponseResult(&request, &response);
                RenderToolResult(&tool_call.name, &display, false)?;
                results.push((
                    tool_call.id.clone(),
                    agent::WrapResult(&tool_call.name, &display),
                    false,
                ));
                continue;
            }

            PrintActivity(&format!("Tool: {}", tool_call.name));
            RenderToolCall(&tool_call)?;
            if mode.RequiresApproval(&tool_call.name) && !ConfirmTool(&tool_call)? {
                results.push((
                    tool_call.id.clone(),
                    agent::WrapResult(&tool_call.name, "Denied by user"),
                    true,
                ));
                continue;
            }

            match agent::ExecuteTool(&tool_call, tool_settings) {
                Ok(outcome) => {
                    if mode.IsAgentic() && tool_call.name == "create_memory" {
                        checkpoint_saved = true;
                    }
                    if let Some(change) = &outcome.change {
                        RenderChangeSummary(change)?;
                    }
                    if !outcome.display.trim().is_empty() {
                        RenderToolResult(&tool_call.name, &outcome.display, false)?;
                    }
                    results.push((
                        tool_call.id.clone(),
                        agent::WrapResult(&tool_call.name, &outcome.display),
                        false,
                    ));
                }
                Err(error) => {
                    RenderToolResult(&tool_call.name, &error, true)?;
                    results.push((
                        tool_call.id.clone(),
                        agent::WrapResult(&tool_call.name, &error),
                        true,
                    ));
                }
            }
        }

        let result_messages = if is_anthropic {
            agent::AnthropicToolResultsMsg(&results)
        } else {
            agent::OpenaiToolResultsMsgs(&results)
        };
        messages.extend(result_messages);

        if mode.IsAgentic() {
            if checkpoint_saved {
                turns_since_checkpoint = 0;
            } else {
                turns_since_checkpoint += 1;
                if turns_since_checkpoint >= 4 {
                    messages.push(json!({
                        "role": "user",
                        "content": "Agentic checkpoint required now. Before any other tool or continued work, call create_memory with the compact added / logic to know / anything extra format for the step just completed."
                    }));
                }
            }
        }
    }

    Err(format!(
        "Agent reached maximum tool call iterations ({MaxIterations})"
    ))
}

fn PrintActivity(label: &str) {
    let _ = StyledPrint(
        "\n[",
        TermColor::Rgb {
            r: 86,
            g: 80,
            b: 95,
        },
        false,
    );
    let _ = StyledPrint(
        label,
        TermColor::Rgb {
            r: 212,
            g: 184,
            b: 122,
        },
        true,
    );
    let _ = StyledPrintln(
        "]",
        TermColor::Rgb {
            r: 86,
            g: 80,
            b: 95,
        },
        false,
    );
}

fn AnimateStatus(label: &str, frames: usize) -> Result<(), String> {
    let spinner = ["-", "\\", "|", "/"];
    let mut stdout = io::stdout();
    for index in 0..frames {
        execute!(
            stdout,
            MoveToColumn(0),
            Clear(ClearType::CurrentLine),
            SetForegroundColor(TermColor::Rgb {
                r: 212,
                g: 184,
                b: 122,
            }),
            Print(format!("{} {label}", spinner[index % spinner.len()])),
            ResetColor
        )
        .map_err(|error| error.to_string())?;
        stdout.flush().map_err(|error| error.to_string())?;
        std::thread::sleep(Duration::from_millis(70));
    }
    execute!(stdout, MoveToColumn(0), Clear(ClearType::CurrentLine))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn PromptQuestionRequest(
    request: &agent::QuestionRequest,
) -> Result<agent::QuestionResponse, String> {
    RenderSection(
        "Clarification",
        TermColor::Rgb {
            r: 138,
            g: 199,
            b: 232,
        },
    )?;

    let mut answers = Vec::new();
    for question in &request.questions {
        let selected = SelectQuestionOption(question)?;
        let option = question
            .options
            .get(selected)
            .or_else(|| question.options.first())
            .ok_or("Question has no options")?;
        let mut message = None;
        if option.label.eq_ignore_ascii_case("Chat about this") {
            print!("Chat about this: ");
            io::stdout().flush().map_err(|error| error.to_string())?;
            let mut input = String::new();
            io::stdin()
                .read_line(&mut input)
                .map_err(|error| error.to_string())?;
            let detail = input.trim().to_string();
            if !detail.is_empty() {
                message = Some(detail);
            }
        }
        answers.push(agent::QuestionAnswer {
            id: question.id.clone(),
            question: question.question.clone(),
            choice: option.label.clone(),
            message,
        });
    }

    Ok(agent::QuestionResponse { answers })
}

fn SelectQuestionOption(question: &agent::UserQuestion) -> Result<usize, String> {
    if !io::stdin().is_terminal() {
        return SelectQuestionOptionPlain(question);
    }

    let _raw = RawModeGuard::new()?;
    let mut selected = 0usize;
    let mut rendered_lines = 0u16;
    RenderQuestionSelector(question, selected, &mut rendered_lines)?;

    loop {
        let Event::Key(key) = event::read().map_err(|error| error.to_string())? else {
            continue;
        };
        if key.kind != KeyEventKind::Press {
            continue;
        }

        match key.code {
            KeyCode::Enter => {
                CleanupPromptRender(rendered_lines)?;
                drop(_raw);
                println!(
                    "{} -> {}",
                    question.question,
                    question
                        .options
                        .get(selected)
                        .map(|option| option.label.as_str())
                        .unwrap_or("")
                );
                return Ok(selected);
            }
            KeyCode::Esc => {
                CleanupPromptRender(rendered_lines)?;
                drop(_raw);
                println!("{} -> Chat about this", question.question);
                let chat_index = question
                    .options
                    .iter()
                    .position(|option| option.label.eq_ignore_ascii_case("Chat about this"))
                    .unwrap_or(selected);
                return Ok(chat_index);
            }
            KeyCode::Up => {
                selected = if selected == 0 {
                    question.options.len().saturating_sub(1)
                } else {
                    selected - 1
                };
            }
            KeyCode::Down => {
                if !question.options.is_empty() {
                    selected = (selected + 1) % question.options.len();
                }
            }
            _ => {}
        }

        RenderQuestionSelector(question, selected, &mut rendered_lines)?;
    }
}

fn SelectQuestionOptionPlain(question: &agent::UserQuestion) -> Result<usize, String> {
    println!("{}", question.question);
    for (index, option) in question.options.iter().enumerate() {
        if option.description.trim().is_empty() {
            println!("  {}. {}", index + 1, option.label);
        } else {
            println!("  {}. {} - {}", index + 1, option.label, option.description);
        }
    }
    print!("Select [1]: ");
    io::stdout().flush().map_err(|error| error.to_string())?;

    let mut input = String::new();
    io::stdin()
        .read_line(&mut input)
        .map_err(|error| error.to_string())?;
    let selected = input
        .trim()
        .parse::<usize>()
        .ok()
        .and_then(|value| value.checked_sub(1))
        .filter(|index| *index < question.options.len())
        .unwrap_or(0);
    Ok(selected)
}

fn RenderQuestionSelector(
    question: &agent::UserQuestion,
    selected: usize,
    rendered_lines: &mut u16,
) -> Result<(), String> {
    let mut stdout = io::stdout();
    if *rendered_lines > 1 {
        execute!(stdout, MoveUp(*rendered_lines - 1)).map_err(|error| error.to_string())?;
    }
    execute!(stdout, MoveToColumn(0), Clear(ClearType::FromCursorDown))
        .map_err(|error| error.to_string())?;

    execute!(
        stdout,
        SetForegroundColor(TermColor::Rgb {
            r: 138,
            g: 199,
            b: 232,
        }),
        Print(format!("{}\n", FitLine(&question.question, 110))),
        ResetColor
    )
    .map_err(|error| error.to_string())?;

    let mut lines = 1u16;
    for (index, option) in question.options.iter().enumerate() {
        let marker = if index == selected { ">" } else { " " };
        let color = if index == selected {
            TermColor::Rgb {
                r: 212,
                g: 176,
                b: 204,
            }
        } else {
            TermColor::Rgb {
                r: 180,
                g: 174,
                b: 188,
            }
        };
        execute!(
            stdout,
            SetForegroundColor(color),
            Print(format!(" {marker} {}\n", FitLine(&option.label, 104))),
            ResetColor
        )
        .map_err(|error| error.to_string())?;
        lines += 1;
        if !option.description.trim().is_empty() {
            execute!(
                stdout,
                SetForegroundColor(TermColor::Rgb {
                    r: 136,
                    g: 128,
                    b: 148,
                }),
                Print(format!("   {}\n", FitLine(&option.description, 104))),
                ResetColor
            )
            .map_err(|error| error.to_string())?;
            lines += 1;
        }
    }

    execute!(
        stdout,
        SetForegroundColor(TermColor::Rgb {
            r: 136,
            g: 128,
            b: 148,
        }),
        Print("Use Up/Down, Enter to select, Esc to chat about this.\n"),
        ResetColor
    )
    .map_err(|error| error.to_string())?;
    lines += 1;
    stdout.flush().map_err(|error| error.to_string())?;
    *rendered_lines = lines;
    Ok(())
}

fn RenderToolCall(tool_call: &agent::ToolCall) -> Result<(), String> {
    RenderSection(
        &format!("Tool {}", tool_call.name),
        TermColor::Rgb {
            r: 212,
            g: 184,
            b: 122,
        },
    )?;
    let summary = CompactJson(&tool_call.input);
    RenderTextLine(&FitLine(&summary, 120))
}

fn RenderToolResult(name: &str, text: &str, error: bool) -> Result<(), String> {
    RenderSection(
        if error { "Tool Error" } else { "Tool Result" },
        if error {
            TermColor::Rgb {
                r: 255,
                g: 111,
                b: 111,
            }
        } else {
            TermColor::Rgb {
                r: 142,
                g: 230,
                b: 164,
            }
        },
    )?;
    if IsChangeTool(name) {
        let lines: Vec<&str> = text.lines().collect();
        for line in lines.iter().take(CHANGE_PREVIEW_LINE_LIMIT) {
            if line.starts_with("+ ") {
                StyledPrintln(
                    line,
                    TermColor::Rgb {
                        r: 142,
                        g: 230,
                        b: 164,
                    },
                    false,
                )?;
            } else if line.starts_with("- ") {
                StyledPrintln(
                    line,
                    TermColor::Rgb {
                        r: 255,
                        g: 111,
                        b: 111,
                    },
                    false,
                )?;
            } else if line.starts_with("change:") || line.starts_with("...") {
                StyledPrintln(
                    line,
                    TermColor::Rgb {
                        r: 136,
                        g: 128,
                        b: 148,
                    },
                    false,
                )?;
            } else {
                RenderTextLine(line)?;
            }
        }
        if lines.len() > CHANGE_PREVIEW_LINE_LIMIT {
            RenderOmittedLines(lines.len() - CHANGE_PREVIEW_LINE_LIMIT)?;
        }
        return Ok(());
    }

    let mut renderer = MarkdownStreamRenderer::WithLimit(TOOL_RESULT_LINE_LIMIT);
    renderer.push(text)?;
    renderer.finish()
}

fn RenderChangeSummary(change: &agent_runtime::AiChangeEvent) -> Result<(), String> {
    RenderSection(
        "Change Applied",
        TermColor::Rgb {
            r: 142,
            g: 230,
            b: 164,
        },
    )?;
    RenderTextLine(&format!(
        "{} {} ({})",
        change.kind, change.path, change.status
    ))
}

fn IsChangeTool(name: &str) -> bool {
    matches!(
        name,
        "write_file"
            | "edit_file"
            | "insert_after"
            | "insert_before"
            | "append_to_file"
            | "replace_range"
            | "remove_range"
            | "write_obsidian"
    )
}

fn ConfirmTool(tool_call: &agent::ToolCall) -> Result<bool, String> {
    println!(
        "\nAllow tool '{}'? {}",
        tool_call.name,
        CompactJson(&tool_call.input)
    );
    print!("Approve? [y/N] ");
    io::stdout().flush().map_err(|error| error.to_string())?;

    let mut input = String::new();
    io::stdin()
        .read_line(&mut input)
        .map_err(|error| error.to_string())?;
    Ok(matches!(input.trim(), "y" | "Y" | "yes" | "YES"))
}

fn CompactJson(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "{}".to_string())
}

async fn StreamAnthropic(
    ApiKey: &str,
    model: &str,
    messages: &[Value],
    system: &str,
) -> Result<(Vec<agent::ToolCall>, Value), String> {
    let client = reqwest::Client::new();
    let tools = agent::ToolDefsAnthropic();
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", ApiKey)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": model,
            "max_tokens": 4096,
            "system": system,
            "messages": messages,
            "tools": tools,
            "stream": true,
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let Text = response.text().await.unwrap_or_default();
        return Err(format!("Anthropic API error {status}: {Text}"));
    }

    let mut blocks: BTreeMap<u64, AnthropicBlock> = BTreeMap::new();
    let mut content: Vec<Value> = Vec::new();
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut renderer = MarkdownStreamRenderer::new();

    while let Some(chunk) = stream.next().await {
        let Text = String::from_utf8_lossy(&chunk.map_err(|error| error.to_string())?).to_string();
        buffer.push_str(&Text);

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[(pos + 1)..].to_string();
            if !line.starts_with("data: ") {
                continue;
            }
            let data = line.trim_start_matches("data: ").trim();
            if data == "[DONE]" {
                continue;
            }

            let event: Value = match serde_json::from_str(data) {
                Ok(event) => event,
                Err(_) => continue,
            };
            HandleAnthropicEvent(&event, &mut blocks, &mut content, &mut renderer)?;
        }
    }
    renderer.finish()?;

    for block in blocks.into_values() {
        let input = if block.input_json.trim().is_empty() {
            json!({})
        } else {
            serde_json::from_str(&block.input_json).unwrap_or_else(|_| json!({}))
        };
        content.push(json!({
            "type": "tool_use",
            "id": block.id,
            "name": block.name,
            "input": input,
        }));
    }

    let ToolCalls = content
        .iter()
        .filter_map(|block| {
            if block.get("type")?.as_str()? != "tool_use" {
                return None;
            }
            Some(agent::ToolCall {
                id: block.get("id")?.as_str()?.to_string(),
                name: block.get("name")?.as_str()?.to_string(),
                input: block.get("input").cloned().unwrap_or_else(|| json!({})),
            })
        })
        .collect();

    Ok((
        ToolCalls,
        json!({ "role": "assistant", "content": content }),
    ))
}

fn HandleAnthropicEvent(
    event: &Value,
    blocks: &mut BTreeMap<u64, AnthropicBlock>,
    content: &mut Vec<Value>,
    renderer: &mut MarkdownStreamRenderer,
) -> Result<(), String> {
    let EventType = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match EventType {
        "content_block_start" => {
            let index = event.get("index").and_then(Value::as_u64).unwrap_or(0);
            let block = event.get("content_block").unwrap_or(&Value::Null);
            if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                blocks.insert(
                    index,
                    AnthropicBlock {
                        id: block
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        name: block
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        input_json: String::new(),
                    },
                );
            }
        }
        "content_block_delta" => {
            let index = event.get("index").and_then(Value::as_u64).unwrap_or(0);
            let delta = event.get("delta").unwrap_or(&Value::Null);
            match delta
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                "text_delta" => {
                    if let Some(Text) = delta.get("text").and_then(Value::as_str) {
                        renderer.push(Text)?;
                        content.push(json!({ "type": "text", "text": Text }));
                    }
                }
                "input_json_delta" => {
                    if let Some(partial) = delta.get("partial_json").and_then(Value::as_str) {
                        if let Some(block) = blocks.get_mut(&index) {
                            block.input_json.push_str(partial);
                        }
                    }
                }
                _ => {}
            }
        }
        _ => {}
    }
    Ok(())
}

async fn StreamDeepseek(
    ApiKey: &str,
    model: &str,
    messages: &[Value],
) -> Result<(Vec<agent::ToolCall>, Value), String> {
    let client = reqwest::Client::new();
    let tools = agent::ToolDefsOpenai();
    let response = client
        .post("https://api.deepseek.com/chat/completions")
        .bearer_auth(ApiKey)
        .json(&json!({
            "model": model,
            "messages": messages,
            "tools": tools,
            "stream": true,
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let Text = response.text().await.unwrap_or_default();
        return Err(format!("DeepSeek API error {status}: {Text}"));
    }

    let mut content = String::new();
    let mut ToolCalls: BTreeMap<u64, OpenAiToolAccumulator> = BTreeMap::new();
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut renderer = MarkdownStreamRenderer::new();

    while let Some(chunk) = stream.next().await {
        let Text = String::from_utf8_lossy(&chunk.map_err(|error| error.to_string())?).to_string();
        buffer.push_str(&Text);

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[(pos + 1)..].to_string();
            if !line.starts_with("data: ") {
                continue;
            }
            let data = line.trim_start_matches("data: ").trim();
            if data == "[DONE]" {
                continue;
            }

            let event: Value = match serde_json::from_str(data) {
                Ok(event) => event,
                Err(_) => continue,
            };
            HandleOpenaiEvent(&event, &mut content, &mut ToolCalls, &mut renderer)?;
        }
    }
    renderer.finish()?;

    let calls: Vec<Value> = ToolCalls
        .iter()
        .map(|(index, call)| {
            json!({
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": call.arguments,
                },
                "index": index,
            })
        })
        .collect();

    let ParsedCalls = ToolCalls
        .into_values()
        .map(|call| agent::ToolCall {
            id: call.id,
            name: call.name,
            input: serde_json::from_str(&call.arguments).unwrap_or_else(|_| json!({})),
        })
        .collect();

    Ok((
        ParsedCalls,
        json!({
            "role": "assistant",
            "content": if content.is_empty() { Value::Null } else { Value::String(content) },
            "tool_calls": calls,
        }),
    ))
}

async fn StreamOpenai(
    ApiKey: &str,
    model: &str,
    messages: &[Value],
) -> Result<(Vec<agent::ToolCall>, Value), String> {
    let client = reqwest::Client::new();
    let tools = agent::ToolDefsOpenai();
    let response = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(ApiKey)
        .json(&json!({
            "model": model,
            "messages": messages,
            "tools": tools,
            "stream": true,
        }))
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let Text = response.text().await.unwrap_or_default();
        return Err(format!("OpenAI API error {status}: {Text}"));
    }

    let mut content = String::new();
    let mut ToolCalls: BTreeMap<u64, OpenAiToolAccumulator> = BTreeMap::new();
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut renderer = MarkdownStreamRenderer::new();

    while let Some(chunk) = stream.next().await {
        let Text = String::from_utf8_lossy(&chunk.map_err(|error| error.to_string())?).to_string();
        buffer.push_str(&Text);

        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer = buffer[(pos + 1)..].to_string();
            if !line.starts_with("data: ") {
                continue;
            }
            let data = line.trim_start_matches("data: ").trim();
            if data == "[DONE]" {
                continue;
            }

            let event: Value = match serde_json::from_str(data) {
                Ok(event) => event,
                Err(_) => continue,
            };
            HandleOpenaiEvent(&event, &mut content, &mut ToolCalls, &mut renderer)?;
        }
    }
    renderer.finish()?;

    let calls: Vec<Value> = ToolCalls
        .iter()
        .map(|(index, call)| {
            json!({
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": call.arguments,
                },
                "index": index,
            })
        })
        .collect();

    let ParsedCalls = ToolCalls
        .into_values()
        .map(|call| agent::ToolCall {
            id: call.id,
            name: call.name,
            input: serde_json::from_str(&call.arguments).unwrap_or_else(|_| json!({})),
        })
        .collect();

    Ok((
        ParsedCalls,
        json!({
            "role": "assistant",
            "content": if content.is_empty() { Value::Null } else { Value::String(content) },
            "tool_calls": calls,
        }),
    ))
}

fn HandleOpenaiEvent(
    event: &Value,
    content: &mut String,
    ToolCalls: &mut BTreeMap<u64, OpenAiToolAccumulator>,
    renderer: &mut MarkdownStreamRenderer,
) -> Result<(), String> {
    let Some(delta) = event
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("delta"))
    else {
        return Ok(());
    };

    if let Some(Text) = delta.get("content").and_then(Value::as_str) {
        renderer.push(Text)?;
        content.push_str(Text);
    }

    if let Some(calls) = delta.get("tool_calls").and_then(Value::as_array) {
        for call in calls {
            let index = call.get("index").and_then(Value::as_u64).unwrap_or(0);
            let entry = ToolCalls.entry(index).or_default();
            if let Some(id) = call.get("id").and_then(Value::as_str) {
                entry.id = id.to_string();
            }
            if let Some(function) = call.get("function") {
                if let Some(name) = function.get("name").and_then(Value::as_str) {
                    entry.name = name.to_string();
                }
                if let Some(args) = function.get("arguments").and_then(Value::as_str) {
                    entry.arguments.push_str(args);
                }
            }
        }
    }

    Ok(())
}
