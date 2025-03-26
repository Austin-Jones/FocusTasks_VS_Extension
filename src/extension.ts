import * as vscode from 'vscode';

interface Task {
  label: string;
  done: boolean;
}

let tasks: Task[] = [];
let copilotPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
  const taskProvider = new TaskTreeProvider(context);
  vscode.window.registerTreeDataProvider("focusTasksView", taskProvider);

  let isFocusViewOpen = false;
  context.subscriptions.push(
    vscode.commands.registerCommand("focusTasks.addTask", async () => {
      const input = await vscode.window.showInputBox({ placeHolder: "Enter your task" });
      if (input) {
        tasks.push({ label: input, done: false });
        taskProvider.refresh();
        saveTasks(context);
      }
    }),

    vscode.commands.registerCommand("focusTasks.toggleTask", (task: Task) => {
      task.done = !task.done;
      taskProvider.refresh();
      saveTasks(context);
    }),

    vscode.commands.registerCommand("focusTasks.deleteTask", (task: Task) => {
      vscode.window.showWarningMessage(
        `Are you sure you want to delete the task: \"${task.label}\"?`,
        { modal: true },
        "Delete"
      ).then(selection => {
        if (selection === "Delete") {
          tasks = tasks.filter(t => t !== task);
          taskProvider.refresh();
          saveTasks(context);
        }
      });
    }),

    vscode.commands.registerCommand("focusTasks.toggleView", async () => {
      if (isFocusViewOpen) {
        await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
        isFocusViewOpen = false;
      } else {
        await vscode.commands.executeCommand("workbench.view.extension.focusTasks");
        isFocusViewOpen = true;
      }
    }),

    vscode.commands.registerCommand("focusTasks.sendToCopilot", async (task: Task, overrideLang?: string) => {
      try {
        const files = await vscode.workspace.findFiles('**/*.{ts,js,py,java,cs,cpp,go,rb,rs}', '**/node_modules/**');
        const languageCounts: Record<string, number> = {};

        files.forEach(file => {
          const ext = file.path.split('.').pop();
          if (ext) {
            languageCounts[ext] = (languageCounts[ext] || 0) + 1;
          }
        });

        const mostCommon = Object.entries(languageCounts).sort((a, b) => b[1] - a[1])[0];
        const topExtension = mostCommon?.[0];

        const extToLang: Record<string, string> = {
          ts: 'TypeScript',
          js: 'JavaScript',
          py: 'Python',
          java: 'Java',
          cs: 'C#',
          cpp: 'C++',
          go: 'Go',
          rb: 'Ruby',
          rs: 'Rust'
        };

        const languageOptions = Object.values(extToLang);

        let defaultLang = overrideLang || context.workspaceState.get<string>('focusTasks.lastUsedLanguage');
        if (!defaultLang) {
          defaultLang = extToLang[topExtension] || 'your language';
        }

        const prompt = `In a ${defaultLang} project, can you help me ${task.label}?`;

        const [model] = await vscode.lm.selectChatModels({
          vendor: 'copilot',
          family: 'gpt-4o'
        });

        if (!model) {
          vscode.window.showErrorMessage('Copilot GPT-4o model not available.');
          return;
        }

        const messages = [
          vscode.LanguageModelChatMessage.User(prompt)
        ];

        const token = new vscode.CancellationTokenSource().token;
        const chatResponse = await model.sendRequest(messages, {}, token);

        if (!copilotPanel) {
          copilotPanel = vscode.window.createWebviewPanel(
            'copilotResponse',
            'Copilot Task',
            vscode.ViewColumn.Beside,
            { enableScripts: true }
          );

          copilotPanel.webview.onDidReceiveMessage(async message => {
            if (message.command === 'changeLanguage') {
              const selectedLang = await vscode.window.showQuickPick(languageOptions, {
                placeHolder: `Select a new language for this task`,
                title: `Override Copilot prompt language:`
              });
              if (selectedLang) {
                await context.workspaceState.update('focusTasks.lastUsedLanguage', selectedLang);
                vscode.commands.executeCommand("focusTasks.sendToCopilot", task, selectedLang);
              }
            }
          });

          copilotPanel.onDidDispose(() => {
            copilotPanel = undefined;
          });
        } else {
          copilotPanel.reveal(vscode.ViewColumn.Beside);
        }

        copilotPanel.webview.html = `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: sans-serif; padding: 1em; }
              #output { border: 1px solid #ccc; padding: 1em; border-radius: 8px; }
              button { margin-bottom: 1em; padding: 0.5em 1em;border-radius: 8px; cursor:pointer; }
            </style>
          </head>
          <body>
            <h2>Copilot Response</h2>
            <button id="changeLang">Change Language and Retry</button>
            <div id="output">Loading...</div>

            <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
            <script>
              const vscode = acquireVsCodeApi();
              let fullContent = '';

              window.addEventListener('message', event => {
                fullContent = event.data;
                document.getElementById('output').innerHTML = marked.parse(fullContent);
              });

              document.getElementById('changeLang').addEventListener('click', () => {
                vscode.postMessage({ command: 'changeLanguage' });
              });
            </script>
          </body>
          </html>
        `;

        let accumulatedResponse = '';
        for await (const fragment of chatResponse.text) {
          accumulatedResponse += fragment;
          copilotPanel.webview.postMessage(accumulatedResponse);
        }

      } catch (err) {
        vscode.window.showErrorMessage(`Failed to send task to Copilot: ${err}`);
      }
    }),

    vscode.commands.registerCommand("focusTasks.addFromSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const selection = editor.document.getText(editor.selection);
        if (selection.trim()) {
          tasks.push({ label: selection.trim(), done: false });
          taskProvider.refresh();
          saveTasks(context);
        } else {
          vscode.window.showInformationMessage("No text selected.");
        }
      }
    })
  );

  loadTasks(context);
}

function saveTasks(context: vscode.ExtensionContext) {
  context.workspaceState.update("focusTasks", tasks);
}

function loadTasks(context: vscode.ExtensionContext) {
  const saved = context.workspaceState.get<Task[]>("focusTasks");
  if (saved) tasks = saved;
}

class TaskTreeProvider implements vscode.TreeDataProvider<Task> {
  private _onDidChangeTreeData: vscode.EventEmitter<Task | undefined> = new vscode.EventEmitter<Task | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Task | undefined> = this._onDidChangeTreeData.event;

  constructor(private context: vscode.ExtensionContext) { }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: Task): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.done ? `✔️ ${element.label}` : element.label,
      vscode.TreeItemCollapsibleState.None
    );
    item.command = {
      command: "focusTasks.toggleTask",
      title: "Toggle Task",
      arguments: [element]
    };
    item.tooltip = element.done ? "Click to unmark" : "Click to mark done";
    item.contextValue = "focusTask";
    return item;
  }

  getChildren(): Thenable<Task[]> {
    return Promise.resolve(tasks);
  }
}
