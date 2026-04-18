import type * as readline from 'node:readline';
import type {
  AgentEvents,
  AppConfig,
  LogLevel,
  ProviderType,
  RuntimeAgentRole,
  RuntimeSink,
  Session,
} from '../foundation/types.js';
import type { SkillRegistry } from '../skills/registry.js';

export interface ReplOptions {
  working_dir: string;
  provider?: ProviderType;
  config?: {
    api_key?: string;
    base_url?: string;
    model?: string;
    max_tokens?: number;
    timeout?: number;
  };
  app_config?: AppConfig;
  readline_interface?: readline.Interface;
  on_exit?: () => void;
  slash_handler?: (input: string, session: Session, skill_reg: SkillRegistry) => boolean;
  events?: AgentEvents;
  logLevel?: LogLevel;
  agentId?: string;
  agentRole?: RuntimeAgentRole;
}

export interface RunReplResult {
  handle_user_input: (input: string) => Promise<void>;
  clear_conversation: () => void;
  start: () => Promise<never>;
}

export interface AgentRuntimeOptions {
  working_dir: string;
  config_path?: string;
  provider?: ProviderType;
  config?: {
    api_key?: string;
    base_url?: string;
    model?: string;
    max_tokens?: number;
    timeout?: number;
  };
  app_config?: AppConfig;
  slash_handler?: (input: string, session: Session, skill_reg: SkillRegistry) => boolean;
  runtime?: RuntimeSink;
  logLevel?: LogLevel;
  agentId?: string;
  agentRole?: RuntimeAgentRole;
}

export interface AgentRuntimeResult {
  handle_user_input: (input: string) => Promise<void>;
  clear_conversation: () => void;
  list_slash_commands: () => Array<{ input: string; description: string }>;
  list_draft_skills: () => Array<{ id: string; name: string; task_type: string }>;
  get_skill_load_message: () => string | null;
}
