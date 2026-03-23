export type ToolHandler = (input: string) => Promise<string>;

class ToolRegistry {
  private readonly tools = new Map<string, ToolHandler>();

  register(name: string, handler: ToolHandler): void {
    this.tools.set(name, handler);
  }

  async run(name: string, input: string): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    return tool(input);
  }
}

export const toolRegistry = new ToolRegistry();
