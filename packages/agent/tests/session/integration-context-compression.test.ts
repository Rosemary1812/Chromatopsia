/**
 * Integration Tests: Context Building + Compression Pipeline
 *
 * 人类可见的端到端测试，专注于：
 * - 展示构建 Context 的完整 Prompt
 * - 展示真实的 LLM 回复（长对话场景）
 * - 展示压缩前/后的消息对比
 * - 展示摘要生成 Prompt 和 LLM 生成的摘要
 *
 * 运行：
 *   cd packages/agent
 *   ANTHROPIC_API_KEY=sk-... pnpm test:watch
 *   （选 integration-context-compression.test.ts 运行）
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { rm, readFileSync } from 'fs/promises';
import { AnthropicProvider } from '../../src/foundation/llm/anthropic.js';
import { SessionManager } from '../../src/agent/session/manager.js';
import { build_llm_context, build_system_prompt } from '../../src/agent/session/context.js';
import {
  compress_session,
  compress_session_recursive,
  build_summarize_prompt,
  needs_compression,
  DEFAULT_COMPRESSION_CONFIG,
} from '../../src/agent/session/summarizer.js';
import type { Message, Skill, CompressionConfig } from '../../src/foundation/types.js';

// 加载项目根目录的 .env 文件
const envPath = resolve(process.cwd(), '../../.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (val && !process.env[key]) process.env[key] = val;
      }
    }
  }
} catch { /* .env not found */ }

// ============================================================
// 彩色日志
// ============================================================

const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;
const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`;
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const BLUE = (s: string) => `\x1b[34m${s}\x1b[0m`;
const DIVIDER = () => console.log(DIM('─'.repeat(80)));
const SECTION = (title: string) => {
  DIVIDER();
  console.log(BOLD(BLUE(`【 ${title} 】`)));
};

function log_prompt(label: string, content: string) {
  SECTION(`PROMPT: ${label}`);
  console.log(content);
  DIVIDER();
}

function log_response(label: string, content: string) {
  SECTION(`LLM RESPONSE: ${label}`);
  console.log(GREEN(content));
  DIVIDER();
}

function log_messages(label: string, messages: Message[]) {
  SECTION(`MESSAGES (${messages.length}条): ${label}`);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const prefix = m.role === 'user' ? YELLOW('U') : m.role === 'assistant' ? BLUE('A') : DIM('S');
    const short = m.content.length > 120 ? m.content.slice(0, 120) + '...' : m.content;
    console.log(`  [${i + 1}] ${prefix} | ${short}`);
  }
  DIVIDER();
}

// ============================================================
// 模拟 SkillRegistry
// ============================================================

const mockSkills: Skill[] = [
  {
    id: 'skill-git',
    name: 'Git Commit',
    trigger_condition: '提交代码，git commit',
    steps: ['git add .', 'git commit -m "描述"', 'git push'],
    pitfalls: ['不要 force push', 'commit message 要清晰'],
    verification: 'git log --oneline -3',
    task_type: 'git',
    created_at: Date.now(),
    updated_at: Date.now(),
    call_count: 0,
    success_count: 0,
  },
  {
    id: 'skill-test',
    name: '运行测试',
    trigger_condition: '运行测试，test',
    steps: ['npm test', '检查测试结果', '修复失败用例'],
    pitfalls: ['不要忽略 flaky test'],
    verification: '所有测试通过',
    task_type: 'test',
    created_at: Date.now(),
    updated_at: Date.now(),
    call_count: 0,
    success_count: 0,
  },
];

const mockSkillReg = {
  register: () => {},
  match: (task_type: string): Skill | null => {
    if (task_type === 'git' || task_type === 'commit') return mockSkills[0];
    if (task_type === 'test' || task_type === 'testing') return mockSkills[1];
    return null;
  },
  fuzzy_match: (query: string): Skill[] => {
    return mockSkills.filter((s) =>
      s.name.includes(query) || s.trigger_condition.includes(query),
    );
  },
  list: () => mockSkills,
  show: (name: string) => mockSkills.find((s) => s.name === name),
  delete: () => {},
  build_directory_listing: () => '',
};

// ============================================================
// 真实的开发对话数据
// ============================================================

function build_realistic_react_conversation(): Message[] {
  return [
    {
      role: 'user',
      content: `我们开始一个新项目，是一个用户管理模块。需要用 React + TypeScript，前端页面有：用户列表、用户详情编辑、新增用户、批量导入。用户数据通过 REST API 从后端获取，后端已经写好了接口文档：

GET /api/users - 获取用户列表（分页）
GET /api/users/:id - 获取单个用户详情
POST /api/users - 新建用户
PUT /api/users/:id - 更新用户
DELETE /api/users/:id - 删除用户

我先初始化项目：npm create vite@latest user-management -- --template react-ts`,
    },
    {
      role: 'assistant',
      content: `好的，项目初始化完成。我先安装依赖，然后搭建基础结构：

1. 安装 axios 用于 HTTP 请求
2. 创建目录结构：
   src/
     api/          - API 调用层
     components/   - React 组件
     types/        - TypeScript 类型定义
     hooks/        - 自定义 hooks
     pages/        - 页面组件

我来逐步实现，先从类型定义开始。`,
    },
    {
      role: 'user',
      content: `好，先定义类型。我需要：User 接口、UserListResponse、UserFormData、PaginationParams，以及 API 错误类型。`,
    },
    {
      role: 'assistant',
      content: `类型定义如下：

\`\`\`typescript
// src/types/user.ts

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  status: 'active' | 'inactive' | 'banned';
  avatar?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserListResponse {
  data: User[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserFormData {
  name: string;
  email: string;
  role: User['role'];
  password?: string;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: User['status'];
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}
\`\`\``,
    },
    {
      role: 'user',
      content: `好的，接下来写 API 层，用 axios。我需要封装一个 base axios instance，支持拦截器、超时、错误处理。`,
    },
    {
      role: 'assistant',
      content: `我来创建 API 层：

\`\`\`typescript
// src/api/client.ts
import axios, { AxiosInstance, AxiosError } from 'axios';
import type { ApiError } from '../types/user';

const client: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = \`Bearer \${token}\`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiError>) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default client;
\`\`\``,
    },
    {
      role: 'user',
      content: `然后写 user API，包含 CRUD 四个函数。`,
    },
    {
      role: 'assistant',
      content: `API 层实现：

\`\`\`typescript
// src/api/users.ts
import client from './client';
import type { User, UserListResponse, UserFormData, PaginationParams } from '../types/user';

export const userApi = {
  list: async (params: PaginationParams): Promise<UserListResponse> => {
    const { data } = await client.get<UserListResponse>('/users', { params });
    return data;
  },
  get: async (id: string): Promise<User> => {
    const { data } = await client.get<User>(\`/users/\${id}\`);
    return data;
  },
  create: async (formData: UserFormData): Promise<User> => {
    const { data } = await client.post<User>('/users', formData);
    return data;
  },
  update: async (id: string, formData: Partial<UserFormData>): Promise<User> => {
    const { data } = await client.put<User>(\`/users/\${id}\`, formData);
    return data;
  },
  delete: async (id: string): Promise<void> => {
    await client.delete(\`/users/\${id}\`);
  },
  batchDelete: async (ids: string[]): Promise<{ deleted: number }> => {
    const { data } = await client.post<{ deleted: number }>('/users/batch-delete', { ids });
    return data;
  },
};
\`\`\``,
    },
    {
      role: 'user',
      content: `API 层写完了。现在开始写页面组件。首先是用户列表页，需要支持分页、搜索、按状态筛选、批量选择。`,
    },
    {
      role: 'assistant',
      content: `用户列表页 UserListPage.tsx：

\`\`\`tsx
// src/pages/UserListPage.tsx
import { useState, useEffect, useCallback } from 'react';
import { userApi } from '../api/users';
import type { User, PaginationParams } from '../types/user';
import { UserTable } from '../components/UserTable';
import { UserFilters } from '../components/UserFilters';
import { Pagination } from '../components/Pagination';

export function UserListPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20, total: 0 });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<PaginationParams>({ page: 1, pageSize: 20, search: '', status: undefined });

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const result = await userApi.list(filters);
      setUsers(result.data);
      setPagination(prev => ({ ...prev, total: result.total }));
    } catch (err) {
      console.error('Failed to fetch users:', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleFilterChange = (newFilters: Partial<PaginationParams>) => {
    setFilters(prev => ({ ...prev, ...newFilters, page: 1 }));
  };

  const handlePageChange = (page: number) => {
    setFilters(prev => ({ ...prev, page }));
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(users.map(u => u.id)) : new Set());
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    const next = new Set(selectedIds);
    checked ? next.add(id) : next.delete(id);
    setSelectedIds(next);
  };

  const handleBatchDelete = async () => {
    if (!confirm(\`确认删除 \${selectedIds.size} 个用户？\`)) return;
    await userApi.batchDelete([...selectedIds]);
    setSelectedIds(new Set());
    fetchUsers();
  };

  return (
    <div className="user-list-page">
      <h1>用户管理</h1>
      <UserFilters onChange={handleFilterChange} />
      {selectedIds.size > 0 && (
        <div className="batch-actions">
          <span>已选择 {selectedIds.size} 项</span>
          <button onClick={handleBatchDelete}>批量删除</button>
        </div>
      )}
      <UserTable users={users} loading={loading} selectedIds={selectedIds}
        onSelectAll={handleSelectAll} onSelectOne={handleSelectOne} />
      <Pagination current={pagination.page} total={pagination.total}
        pageSize={pagination.pageSize} onChange={handlePageChange} />
    </div>
  );
}
\`\`\``,
    },
    {
      role: 'user',
      content: `现在写 UserTable 组件，需要支持排序、点击行跳转详情。`,
    },
    {
      role: 'assistant',
      content: `UserTable.tsx：

\`\`\`tsx
// src/components/UserTable.tsx
import { useNavigate } from 'react-router-dom';
import type { User } from '../types/user';

interface Props {
  users: User[];
  loading: boolean;
  selectedIds: Set<string>;
  onSelectAll: (checked: boolean) => void;
  onSelectOne: (id: string, checked: boolean) => void;
}

export function UserTable({ users, loading, selectedIds, onSelectAll, onSelectOne }: Props) {
  const navigate = useNavigate();

  if (loading) return <div className="loading-spinner">加载中...</div>;
  if (users.length === 0) return <div className="empty-state">暂无数据</div>;

  const allSelected = users.length > 0 && users.every(u => selectedIds.has(u.id));

  return (
    <table className="user-table">
      <thead>
        <tr>
          <th><input type="checkbox" checked={allSelected} onChange={e => onSelectAll(e.target.checked)} /></th>
          <th>ID</th><th>姓名</th><th>邮箱</th><th>角色</th><th>状态</th><th>创建时间</th>
        </tr>
      </thead>
      <tbody>
        {users.map(user => (
          <tr key={user.id} onClick={() => navigate(\`/users/\${user.id}\`)} style={{ cursor: 'pointer' }}>
            <td onClick={e => e.stopPropagation()}>
              <input type="checkbox" checked={selectedIds.has(user.id)}
                onChange={e => onSelectOne(user.id, e.target.checked)} />
            </td>
            <td>{user.id.slice(0, 8)}</td>
            <td>{user.name}</td>
            <td>{user.email}</td>
            <td><span className={\`role-badge role-\${user.role}\`}>{user.role}</span></td>
            <td><span className={\`status-badge status-\${user.status}\`}>{user.status}</span></td>
            <td>{new Date(user.createdAt).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
\`\`\``,
    },
    {
      role: 'user',
      content: `用户编辑页面也写一下，包含表单验证和错误处理。表单字段：name、email、role、status。`,
    },
    {
      role: 'assistant',
      content: `用户编辑页 UserEditPage.tsx：

\`\`\`tsx
// src/pages/UserEditPage.tsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { userApi } from '../api/users';
import type { User, UserFormData } from '../types/user';
import { useUserForm } from '../hooks/useUserForm';

export function UserEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = !id;
  const [loading, setLoading] = useState(!isNew);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { errors, validate } = useUserForm();
  const [form, setForm] = useState<UserFormData>({ name: '', email: '', role: 'viewer' });

  useEffect(() => {
    if (!isNew && id) {
      userApi.get(id).then(user => {
        setForm({ name: user.name, email: user.email, role: user.role });
      }).catch(() => setServerError('无法加载用户信息'))
        .finally(() => setLoading(false));
    }
  }, [id, isNew]);

  const handleChange = (field: keyof UserFormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) validate({ ...form, [field]: value }, field);
    setServerError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate(form)) return;
    setSubmitting(true);
    setServerError(null);
    try {
      if (isNew) await userApi.create(form);
      else await userApi.update(id!, form);
      navigate('/users');
    } catch (err: any) {
      setServerError(err?.response?.data?.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div>加载中...</div>;

  return (
    <div className="user-edit-page">
      <h1>{isNew ? '新建用户' : '编辑用户'}</h1>
      <form onSubmit={handleSubmit}>
        <div className="form-field">
          <label>姓名 *</label>
          <input type="text" value={form.name}
            onChange={e => handleChange('name', e.target.value)}
            className={errors.name ? 'error' : ''} />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </div>
        <div className="form-field">
          <label>邮箱 *</label>
          <input type="email" value={form.email}
            onChange={e => handleChange('email', e.target.value)}
            className={errors.email ? 'error' : ''} />
          {errors.email && <span className="field-error">{errors.email}</span>}
        </div>
        <div className="form-field">
          <label>角色 *</label>
          <select value={form.role} onChange={e => handleChange('role', e.target.value)}>
            <option value="admin">管理员</option><option value="editor">编辑</option><option value="viewer">查看者</option>
          </select>
        </div>
        {serverError && <div className="server-error">{serverError}</div>}
        <div className="form-actions">
          <button type="button" onClick={() => navigate('/users')}>取消</button>
          <button type="submit" disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
        </div>
      </form>
    </div>
  );
}
\`\`\``,
    },
    {
      role: 'user',
      content: `现在写 useUserForm 这个 hook，集成 Zod 做表单验证。`,
    },
    {
      role: 'assistant',
      content: `useUserForm hook：

\`\`\`typescript
// src/hooks/useUserForm.ts
import { useState, useCallback } from 'react';
import { z } from 'zod';
import type { UserFormData } from '../types/user';

const userFormSchema = z.object({
  name: z.string().min(2, '姓名至少2个字符').max(50, '姓名最多50个字符'),
  email: z.string().email('请输入有效的邮箱地址'),
  role: z.enum(['admin', 'editor', 'viewer']),
  password: z.string().min(6, '密码至少6个字符').optional(),
});

type UserFormErrors = Partial<Record<keyof UserFormData, string>>;

export function useUserForm() {
  const [errors, setErrors] = useState<UserFormErrors>({});

  const validate = useCallback((data: UserFormData, field?: keyof UserFormData): boolean => {
    try {
      const schema = field
        ? userFormSchema.pick({ [field]: userFormSchema.shape[field] } as any)
        : userFormSchema;
      if (field) {
        schema.parse({ [field]: data[field] } as any);
        setErrors(prev => ({ ...prev, [field]: undefined }));
      } else {
        schema.parse(data);
        setErrors({});
      }
      return true;
    } catch (err: any) {
      const fieldErrors: UserFormErrors = {};
      for (const issue of err.issues ?? []) {
        const path = issue.path[0] as keyof UserFormData;
        if (path) fieldErrors[path] = issue.message;
      }
      setErrors(fieldErrors);
      return false;
    }
  }, []);

  return { errors, validate };
}
\`\`\``,
    },
    {
      role: 'user',
      content: `好，现在写 UserFilters 和 Pagination 组件。`,
    },
    {
      role: 'assistant',
      content: `UserFilters.tsx 和 Pagination.tsx：

\`\`\`tsx
// src/components/UserFilters.tsx
import { useState } from 'react';
import type { PaginationParams, User } from '../types/user';

interface Props { onChange: (filters: Partial<PaginationParams>) => void; }

export function UserFilters({ onChange }: Props) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<User['status'] | ''>('');

  return (
    <div className="user-filters">
      <input type="search" placeholder="搜索姓名或邮箱..." value={search}
        onChange={e => setSearch(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && onChange({ search })} />
      <select value={status} onChange={e => { setStatus(e.target.value as any); onChange({ status: e.target.value || undefined }); }}>
        <option value="">全部状态</option>
        <option value="active">活跃</option><option value="inactive">未激活</option><option value="banned">已封禁</option>
      </select>
      <button onClick={() => onChange({ search })}>搜索</button>
    </div>
  );
}

// src/components/Pagination.tsx
interface PProps { current: number; total: number; pageSize: number; onChange: (page: number) => void; }

export function Pagination({ current, total, pageSize, onChange }: PProps) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  const getPages = () => {
    const delta = 2;
    const range: number[] = [];
    for (let i = Math.max(1, current - delta); i <= Math.min(totalPages, current + delta); i++) range.push(i);
    return range;
  };
  return (
    <div className="pagination">
      <button disabled={current === 1} onClick={() => onChange(1)}>«</button>
      <button disabled={current === 1} onClick={() => onChange(current - 1)}>‹</button>
      {getPages().map(page => (
        <button key={page} className={page === current ? 'active' : ''} onClick={() => onChange(page)}>{page}</button>
      ))}
      <button disabled={current === totalPages} onClick={() => onChange(current + 1)}>›</button>
      <button disabled={current === totalPages} onClick={() => onChange(totalPages)}>»</button>
      <span className="page-info">第 {current} / {totalPages} 页，共 {total} 条</span>
    </div>
  );
}
\`\`\``,
    },
    {
      role: 'user',
      content: `好，现在开始写测试。我需要为 userApi、UserTable、useUserForm 写测试。`,
    },
    {
      role: 'assistant',
      content: `测试文件：

\`\`\`typescript
// src/api/users.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { userApi } from './users';
vi.mock('./client', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
import client from './client';
const mockedClient = client as any;

describe('userApi', () => {
  beforeEach(() => vi.clearAllMocks());
  describe('list', () => {
    it('should fetch user list with pagination', async () => {
      mockedClient.get.mockResolvedValue({ data: { data: [{ id: '1', name: 'Alice', email: 'alice@example.com', role: 'admin', status: 'active', createdAt: '2024-01-01', updatedAt: '2024-01-01' }], total: 1, page: 1, pageSize: 20 } });
      const result = await userApi.list({ page: 1, pageSize: 20 });
      expect(result.total).toBe(1);
      expect(result.data[0].name).toBe('Alice');
    });
    it('should send search and status filters', async () => {
      mockedClient.get.mockResolvedValue({ data: { data: [], total: 0, page: 1, pageSize: 20 } });
      await userApi.list({ page: 1, pageSize: 20, search: 'alice', status: 'active' });
      expect(mockedClient.get).toHaveBeenCalledWith('/users', { params: { page: 1, pageSize: 20, search: 'alice', status: 'active' } });
    });
  });
  describe('create', () => {
    it('should create a new user', async () => {
      mockedClient.post.mockResolvedValue({ data: { id: '2', name: 'Bob', email: 'bob@example.com', role: 'editor', status: 'active', createdAt: '2024-01-02', updatedAt: '2024-01-02' } });
      const result = await userApi.create({ name: 'Bob', email: 'bob@example.com', role: 'editor' });
      expect(result.id).toBe('2');
    });
  });
  describe('update', () => {
    it('should update an existing user', async () => {
      mockedClient.put.mockResolvedValue({ data: { id: '1', name: 'Alice Updated', email: 'alice@example.com', role: 'admin', status: 'active', createdAt: '2024-01-01', updatedAt: '2024-01-03' } });
      const result = await userApi.update('1', { name: 'Alice Updated' });
      expect(result.name).toBe('Alice Updated');
    });
  });
  describe('delete', () => {
    it('should delete a user', async () => {
      mockedClient.delete.mockResolvedValue(undefined);
      await userApi.delete('1');
      expect(mockedClient.delete).toHaveBeenCalledWith('/users/1');
    });
  });
});
\`\`\``,
    },
    {
      role: 'user',
      content: `useUserForm 的测试也写一下。`,
    },
    {
      role: 'assistant',
      content: `useUserForm 测试：

\`\`\`typescript
// src/hooks/useUserForm.test.ts
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUserForm } from './useUserForm';

describe('useUserForm', () => {
  it('should return no errors for valid data', () => {
    const { result } = renderHook(() => useUserForm());
    const valid = { name: 'Alice', email: 'alice@example.com', role: 'admin' as const };
    expect(result.current.validate(valid)).toBe(true);
    expect(result.current.errors).toEqual({});
  });
  it('should catch invalid email', () => {
    const { result } = renderHook(() => useUserForm());
    const invalid = { name: 'Alice', email: 'not-an-email', role: 'admin' as const };
    expect(result.current.validate(invalid)).toBe(false);
    expect(result.current.errors.email).toBeDefined();
  });
  it('should catch name too short', () => {
    const { result } = renderHook(() => useUserForm());
    const invalid = { name: 'A', email: 'alice@example.com', role: 'admin' as const };
    expect(result.current.validate(invalid)).toBe(false);
    expect(result.current.errors.name).toContain('至少2个字符');
  });
  it('should validate single field', () => {
    const { result } = renderHook(() => useUserForm());
    const data = { name: 'Alice', email: '', role: 'admin' as const };
    result.current.validate(data, 'email');
    expect(result.current.errors.email).toBeDefined();
  });
});
\`\`\``,
    },
    {
      role: 'user',
      content: `好，代码基本完成了。现在有个 bug：用户列表页删除用户后，total 没有更新，导致分页显示错误。另外批量删除的成功提示没显示。帮我排查一下。`,
    },
    {
      role: 'assistant',
      content: `好，我来排查这两个问题。

**Bug 1：删除后 total 没更新**

在 UserListPage.tsx 的 handleBatchDelete 中，调用 fetchUsers() 后 pagination.total 没有同步更新。需要修改 fetchUsers 中：

\`\`\`typescript
const fetchUsers = useCallback(async () => {
  setLoading(true);
  try {
    const result = await userApi.list(filters);
    setUsers(result.data);
    setPagination(prev => ({ ...prev, total: result.total }));
  } catch (err) {
    console.error('Failed to fetch users:', err);
  } finally {
    setLoading(false);
  }
}, [filters]);
\`\`\`

**Bug 2：批量删除成功提示没显示**

需要加 state 和显示逻辑：

\`\`\`typescript
const [successMsg, setSuccessMsg] = useState<string | null>(null);

const handleBatchDelete = async () => {
  if (!confirm(...)) return;
  const { deleted } = await userApi.batchDelete([...selectedIds]);
  setSelectedIds(new Set());
  setSuccessMsg(\`成功删除 \${deleted} 个用户\`);
  fetchUsers();
  setTimeout(() => setSuccessMsg(null), 3000);
};
\`\`\`

JSX 中加：\`<div className="success-msg">{successMsg}</div>\``,
    },
    {
      role: 'user',
      content: `修复了这两个 bug。另外我发现列表接口有字段变化：后端返回的字段从 id 改成了 _id，createdAt 改成了 created_at。你检查一下所有用到这些字段的地方。`,
    },
    {
      role: 'assistant',
      content: `检查结果，涉及字段的地方：

1. **src/types/user.ts** — 适配两种字段名
2. **src/pages/UserListPage.tsx** — \`new Date(user.createdAt)\` 需兼容
3. **src/api/users.test.ts** — mock 数据字段同步

建议在 API 层做统一字段映射：

\`\`\`typescript
function normalizeUser(raw: any): User {
  return {
    id: raw._id ?? raw.id,
    createdAt: raw.created_at ?? raw.createdAt,
    updatedAt: raw.updated_at ?? raw.updatedAt,
    name: raw.name,
    email: raw.email,
    role: raw.role,
    status: raw.status,
    avatar: raw.avatar,
  };
}
\`\`\`

在 userApi.list/get 返回前调用 normalizeUser，上层组件无需改动。`,
    },
    {
      role: 'user',
      content: `好，就按这个 normalizeUser 方案来修复。我再跑一下测试看看情况。`,
    },
    {
      role: 'assistant',
      content: `运行测试结果：

\`\`\`
PASS src/api/users.test.ts
PASS src/hooks/useUserForm.test.ts
Test Suites: 2 passed, 2 passed
Tests: 12 passed, 12 passed
Total: 12 passed
\`\`\`

所有测试通过！修复方案生效。`,
    },
    {
      role: 'user',
      content: `现在还需要添加批量导入用户功能，需要支持 CSV 导入。`,
    },
    {
      role: 'assistant',
      content: `批量导入用户功能实现方案：

后端接口：POST /api/users/import，接收 multipart/form-data，CSV 文件

前端实现：
1. ImportUsersPage 组件：文件上传区、预览表格、导入进度条
2. papaparse 解析 CSV
3. 验证每行数据，错误行标记但不阻塞
4. 支持部分导入（跳过错误行）

\`\`\`typescript
// src/utils/csv.ts
import Papa from 'papaparse';

interface ParseResult<T> {
  data: T[];
  errors: { row: number; message: string }[];
}

export function parseCSV<T>(file: File): Promise<ParseResult<T>> {
  return new Promise(resolve => {
    Papa.parse<T>(file, {
      header: true,
      skipEmptyLines: true,
      complete: results => {
        resolve({ data: results.data, errors: results.errors.map(e => ({ row: e.row ?? 0, message: e.message })) });
      },
    });
  });
}
\`\`\`

导入流程：选择文件 → 解析预览 → 用户确认 → 发送到后端 → 显示导入结果（成功/失败数量）`,
    },
    {
      role: 'user',
      content: `好，代码实现完了，测试也都通过了。现在项目基本完成了，帮我整理一下 git commit。`,
    },
    {
      role: 'assistant',
      content: `好的，按功能模块整理 commit：

**Commit 1：初始化项目结构**
\`\`\`
feat: 初始化项目，搭建目录结构
- 创建目录：api/, components/, types/, hooks/, pages/
- 安装依赖：axios, react-router-dom, papaparse
\`\`\`

**Commit 2：实现 API 层和类型定义**
\`\`\`
feat: 实现用户 API 层和类型定义
- 定义 User, UserListResponse, PaginationParams 等类型
- 封装 axios client（拦截器/超时/错误处理）
- 实现 userApi: list, get, create, update, delete, batchDelete
- normalizeUser 统一字段映射
\`\`\`

**Commit 3：实现用户列表页**
\`\`\`
feat: 用户列表页 UserListPage
- 分页、搜索、状态筛选、批量选择和删除
- 修复删除后 total 不更新的 bug
\`\`\`

**Commit 4：实现用户编辑页**
\`\`\`
feat: 用户编辑页 UserEditPage
- 新建/编辑用户表单，useUserForm hook 集成 Zod 验证
\`\`\`

**Commit 5：实现表格和筛选组件**
\`\`\`
feat: UserTable, UserFilters, Pagination 组件
\`\`\`

**Commit 6：编写单元测试**
\`\`\`
test: userApi 和 useUserForm 单元测试（12 个测试全部通过）
\`\`\`

**Commit 7：修复后端字段变更**
\`\`\`
fix: 适配后端 _id 和 created_at 字段变更
\`\`\`

**Commit 8：添加批量导入功能**
\`\`\`
feat: 批量导入用户（CSV）
\`\`\`

建议 squash merge 到 main 分支。`,
    },
  ];
}

// ============================================================
// 测试
// ============================================================

const API_KEY = process.env.ANTHROPIC_API_KEY;
const API_BASE_URL = process.env.ANTHROPIC_BASE_URL;
const skipIfNoApiKey = (name: string) => {
  if (!API_KEY) {
    console.log(DIM(`\n[SKIP] ${name} — ANTHROPIC_API_KEY not set\n`));
  }
  return !API_KEY;
};

describe('【集成测试】上下文构建 + 压缩 pipeline', () => {
  let provider: AnthropicProvider | null = null;
  let manager: SessionManager;
  const testDir = resolve(process.cwd(), '.test-integration-' + randomUUID().slice(0, 8));

  beforeAll(async () => {
    if (API_KEY) {
      provider = new AnthropicProvider({
        api_key: API_KEY,
        base_url: API_BASE_URL || undefined,
        model: 'claude-haiku-4-5-20250101',
      });
      console.log(BOLD(GREEN(`\n✓ Initialized with real Anthropic API (${API_BASE_URL})\n`)));
    } else {
      console.log(BOLD(YELLOW('\n⚠ Running in LOG-ONLY mode (no ANTHROPIC_API_KEY)\n')));
    }
    manager = new SessionManager(testDir);
  });

  // ============================================================
  // T1: Context Building
  // ============================================================

  describe('T1: Context Building', () => {
    it('T1-a: System Prompt（空 session）', () => {
      const session = manager.create_session('/workspace/test');
      const prompt = build_system_prompt(session);
      log_prompt('System Prompt (empty)', prompt);
      expect(prompt).toContain('Chromatopsia');
    });

    it('T1-b: System Prompt（带项目+用户上下文）', () => {
      const session = manager.create_session('/workspace/myapp');
      session.project_context = { name: 'MyApp', root: '/workspace/myapp', language: 'TypeScript', framework: 'React', description: '一个 React + TypeScript 用户管理模块' };
      session.user_context = { name: 'Rosemary', preferences: { theme: 'dark', auto_save: true } };
      const prompt = build_system_prompt(session);
      log_prompt('System Prompt (project + user)', prompt);
      expect(prompt).toContain('【项目】MyApp');
      expect(prompt).toContain('Rosemary');
    });

    it('T1-c: 完整 LLM Context（system + history）', () => {
      const session = manager.create_session('/workspace/test');
      session.project_context = { name: 'UserManagement', root: '/workspace/test', language: 'TypeScript' };
      session.messages.push(...build_realistic_react_conversation());

      const ctx = build_llm_context(session, 'coding', null, mockSkillReg as any);

      SECTION('T1-c: 完整 LLM Context');
      console.log(BOLD(YELLOW(`发送给 LLM 的 messages (${ctx.messages.length} 条):\n`)));
      let totalChars = 0;
      for (let i = 0; i < ctx.messages.length; i++) {
        const m = ctx.messages[i];
        totalChars += m.content.length;
        console.log(BOLD(`[${i + 1}] ${m.role.toUpperCase()} — ${m.content.length} chars`));
        console.log(DIM(m.content.slice(0, 200) + (m.content.length > 200 ? '...' : '')));
        console.log();
      }
      console.log(DIM(`总字符数: ~${totalChars} (估算 tokens: ~${Math.round(totalChars / 4)})`));

      expect(ctx.messages.length).toBeGreaterThan(0);
      expect(ctx.messages[0].role).toBe('system');
      console.log(GREEN(`✓ Context 构建成功: ${ctx.messages.length} 条消息，约 ${Math.round(totalChars / 4)} tokens`));
    });

    it('T1-d: Skill 精准匹配注入', () => {
      const session = manager.create_session('/workspace/test');
      const matchedSkill = mockSkillReg.match('git')!;
      const ctx = build_llm_context(session, 'git', matchedSkill, mockSkillReg as any);
      const skillMsg = ctx.messages.find(m => m.content.includes('【技能】'));
      SECTION('T1-d: Skill 精准匹配注入');
      console.log(BOLD(YELLOW('Skill Block:')));
      console.log(skillMsg?.content ?? '(未找到)');
      expect(skillMsg).toBeDefined();
      expect(skillMsg?.content).toContain('Git Commit');
    });

    it('T1-e: Fuzzy Match 降级', () => {
      const session = manager.create_session('/workspace/test');
      const ctx = build_llm_context(session, 'git commit', null, mockSkillReg as any);
      const relatedMsg = ctx.messages.find(m => m.content.includes('【相关经验】'));
      SECTION('T1-e: Fuzzy Match 降级');
      console.log(BOLD(YELLOW('Related Skills Block:')));
      console.log(relatedMsg?.content ?? '(未找到)');
      expect(relatedMsg).toBeDefined();
      expect(relatedMsg?.content).toContain('Git Commit');
    });
  });

  // ============================================================
  // T2: Compression
  // ============================================================

  describe('T2: Compression Pipeline', () => {
    it('T2-a: needs_compression 阈值判断（用真实对话数据）', () => {
      SECTION('T2-a: needs_compression 阈值测试（真实对话）');
      const messages = build_realistic_react_conversation();
      const config = DEFAULT_COMPRESSION_CONFIG;
      const estimated = messages.length * 200;
      const needed = needs_compression(messages, config);

      console.log(`  对话条数: ${messages.length}`);
      console.log(`  每条约 200 tokens 估算，总估算: ~${estimated} tokens`);
      console.log(`  阈值: ${config.compress_threshold} tokens`);
      console.log(`  needs_compression: ${needed}`);

      log_messages('待压缩消息', messages);
      expect(needed).toBe(true);
      console.log(GREEN('✓ 触发压缩条件'));
    });

    it('T2-b: build_summarize_prompt 格式（用真实对话）', () => {
      const messages = build_realistic_react_conversation();
      const prompt = build_summarize_prompt(messages);
      log_prompt('Summarize Prompt (真实对话)', prompt);
      expect(prompt).toContain('对话历史');
      expect(prompt).toContain('用户管理');
    });

    it('T2-c: 真实 LLM 压缩（需 API Key）', async () => {
      if (skipIfNoApiKey('T2-c: 真实 LLM 压缩')) return;

      SECTION('T2-c: 真实 LLM 压缩 — 摘要模式');
      const messages = build_realistic_react_conversation();
      const config: CompressionConfig = { compress_threshold: 2000, preserve_recent: 4, min_summarizable: 6 };

      console.log(BOLD(YELLOW(`\n原始对话: ${messages.length} 条`)));
      console.log(DIM(`估算 tokens: ~${messages.length * 200}`));
      console.log(`配置: compress_threshold=${config.compress_threshold}, preserve_recent=${config.preserve_recent}`);

      log_messages('压缩前', messages);

      const result = await compress_session(messages, config, provider!);

      SECTION('压缩结果');
      console.log(`  类型: ${result.metadata.type}`);
      console.log(`  原始: ${result.metadata.original_count} 条`);
      console.log(`  压缩后: ${result.metadata.preserved_count} 条`);

      log_messages('压缩后', result.compressed);

      if (result.metadata.type === 'summarize') {
        const summaryMsg = result.compressed[0];
        console.log(BOLD(GREEN('\n========== LLM 生成的摘要 ==========')));
        console.log(summaryMsg.content);
        console.log(BOLD(GREEN('======================================')));
      }

      expect(result.metadata.type).toBe('summarize');
      expect(result.compressed.length).toBeLessThan(messages.length);
      console.log(GREEN(`\n✓ 压缩成功: ${messages.length} → ${result.compressed.length} 条`));
    }, 60000);

    it('T2-d: 递归压缩（多次 LLM 调用）', async () => {
      if (skipIfNoApiKey('T2-d: 递归压缩')) return;

      SECTION('T2-d: 递归压缩 — 多次 LLM 调用');
      const messages: Message[] = [];
      const base = build_realistic_react_conversation();
      for (let round = 0; round < 3; round++) {
        messages.push(...base.map(m => ({ ...m, content: `[Round${round + 1}] ${m.content}` })));
      }

      console.log(BOLD(YELLOW(`超长对话: ${messages.length} 条消息`)));
      console.log(DIM(`估算 tokens: ~${messages.length * 200}`));

      const config: CompressionConfig = { compress_threshold: 1500, preserve_recent: 4, min_summarizable: 6 };
      log_messages('超长对话（部分）', messages.slice(0, 10));

      const result = await compress_session_recursive(messages, config, provider!, 3);

      SECTION('递归压缩结果');
      console.log(`  最终消息数: ${result.compressed.length}`);
      console.log(`  原始消息数: ${result.metadata.original_count}`);
      console.log(`  压缩类型: ${result.metadata.type}`);

      if (result.compressed[0]?.content.includes('【历史摘要】')) {
        console.log(BOLD(GREEN('\n===== 第一层摘要 =====')));
        console.log(result.compressed[0].content);
        console.log(BOLD(GREEN('========================')));
      }

      expect(result.compressed.length).toBeLessThan(messages.length);
      console.log(GREEN(`\n✓ 递归压缩成功: ${messages.length} → ${result.compressed.length} 条`));
    }, 60000);
  });

  // ============================================================
  // T3: 端到端 Pipeline
  // ============================================================

  describe('T3: 端到端 Pipeline', () => {
    it('T3: 构建 → 发送 → LLM 回复 → 压缩', async () => {
      if (skipIfNoApiKey('T3: 端到端 Pipeline')) return;

      SECTION('T3: 端到端 Pipeline');

      const session = manager.create_session('/workspace/myproject');
      session.project_context = { name: 'UserManagement', root: '/workspace/myproject', language: 'TypeScript', framework: 'React', description: 'React + TypeScript 用户管理模块' };
      const conversation = build_realistic_react_conversation();
      session.messages.push(...conversation);

      console.log(BOLD(YELLOW('Step 1: 初始消息')));
      console.log(`  ${session.messages.length} 条对话`);

      const ctx = build_llm_context(session, 'coding', null, mockSkillReg as any);

      console.log(BOLD(YELLOW(`\nStep 2: 构建 LLM Context (${ctx.messages.length} 条消息)`)));
      for (let i = 0; i < ctx.messages.length; i++) {
        const m = ctx.messages[i];
        console.log(DIM(`\n--- messages[${i}] (${m.role}) [${m.content.length} chars] ---`));
        console.log(m.content.slice(0, 400) + (m.content.length > 400 ? '\n...(截断)...' : ''));
      }

      // T3: 直接用原始对话 + system prompt 发给 LLM
      // build_llm_context 把所有内容放 system 消息里，这里直接用原始对话测试完整 pipeline
      const systemPrompt = build_system_prompt(session);
      const llmMessages = [
        { role: 'system' as const, content: systemPrompt },
        ...conversation,
      ];

      SECTION('Step 3: 发送 Context 到 LLM');
      console.log(`发送 ${llmMessages.length} 条消息（1 system + ${conversation.length} 对话）`);
      console.log(DIM(`System prompt 长度: ${systemPrompt.length} chars`));

      const response = await provider!.chat(llmMessages);
      log_response('LLM 回复', response.content);

      const config: CompressionConfig = { compress_threshold: 1500, preserve_recent: 4, min_summarizable: 6 };
      const needed = needs_compression(session.messages, config);
      console.log(BOLD(YELLOW(`\nStep 4: needs_compression = ${needed}`)));

      if (needed) {
        const result = await compress_session(session.messages, config, provider!);

        SECTION('Step 5: 压缩结果');
        console.log(`  类型: ${result.metadata.type}`);
        console.log(`  ${session.messages.length} → ${result.compressed.length} 条`);

        if (result.metadata.type === 'summarize') {
          console.log(BOLD(GREEN('\n========== LLM 摘要 ==========')));
          console.log(result.compressed[0].content);
          console.log(BOLD(GREEN('==============================')));
        }

        log_messages('压缩后消息', result.compressed);
      }

      console.log(GREEN('\n✓ 端到端 Pipeline 测试完成'));
    }, 60000);
  });
});
