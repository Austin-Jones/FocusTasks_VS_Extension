import * as vscode from 'vscode';

interface Task {
  label: string;
  done: boolean;
}

let tasks: Task[] = [];

export function activate(context: vscode.ExtensionContext) {
  const taskProvider = new TaskTreeProvider(context);
  vscode.window.registerTreeDataProvider("focusTasksView", taskProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand("focusTasks.addTask", async () => {
      if (tasks.length >= 3) {
        vscode.window.showWarningMessage("Only 3 tasks allowed!");
        return;
      }
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

  constructor(private context: vscode.ExtensionContext) {}

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
    item.contextValue = "task";
    item.tooltip = element.done ? "Click to unmark" : "Click to mark done";
    return item;
  }

  getChildren(): Thenable<Task[]> {
    return Promise.resolve(tasks);
  }
}
