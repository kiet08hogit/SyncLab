import path from 'node:path';
import { parse } from '@babel/parser';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { API_HOSTS, lookupOperation, SDK_PACKAGES, type ApiProvider } from './api-operations.js';
import { PARSER_OPTIONS } from './imports.js';

export interface SourceFile {
  /** Repository-relative, with forward slashes. */
  path: string;
  contents: string;
}

export interface ApiUsage {
  provider: ApiProvider;
  file: string;
  line: number;
  style: 'sdk' | 'http';
  /** The SDK method path relative to the client, such as `beta.messages.stream`. */
  method?: string;
  /** Such as `POST /v1/messages`. Null when the call is not in the operation table. */
  operation: string | null;
  /** Keys of the request object, when it is written out. */
  params: string[];
  /** Model IDs written as literals in the request. */
  modelIds: string[];
  /** True when part of the request is only known at runtime, such as a model read from config. */
  dynamic: boolean;
}

export interface ApiUsageScan {
  usages: ApiUsage[];
  /** Files the parser could not read at all. */
  unparsed: string[];
}

interface ExportEntry {
  /** The local binding the export points at. */
  id?: t.Node;
  /** An exported expression with no binding, such as `export default new OpenAI()`. */
  expr?: NodePath;
  /** A re-export, such as `export { x } from './y'`. */
  from?: { file: string; name: string };
}

interface FileFacts {
  file: SourceFile;
  ast: t.File;
  sdkClasses: Map<t.Node, ApiProvider>;
  sdkNamespaces: Map<t.Node, ApiProvider>;
  axios: Set<t.Node>;
  clients: Map<t.Node, ApiProvider>;
  factories: Map<t.Node, ApiProvider>;
  /** Class fields assigned a client, read back as `this.<name>`. */
  thisClients: Map<string, ApiProvider>;
  /** Bindings imported from another file of the repository. */
  links: Array<{ id: t.Node; file: string; name: string }>;
  /** Bindings that hold a whole module, as `import * as m` or `const m = require()`. */
  namespaces: Map<t.Node, string>;
  exports: Map<string, ExportEntry>;
  starExports: string[];
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
// A TypeScript ESM project imports `./model.js` and means `./model.ts`.
const COMPILED_EXTENSIONS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};
const AXIOS_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'request']);
const MAX_RESOLVE_DEPTH = 10;

function resolveRelative(fromFile: string, specifier: string, known: Set<string>): string | undefined {
  if (!specifier.startsWith('.')) {
    return undefined;
  }

  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  const extension = path.posix.extname(base);
  const candidates = [base];

  for (const compiled of COMPILED_EXTENSIONS[extension] ?? []) {
    candidates.push(base.slice(0, -extension.length) + compiled);
  }

  for (const sourceExtension of SOURCE_EXTENSIONS) {
    candidates.push(base + sourceExtension, `${base}/index${sourceExtension}`);
  }

  return candidates.find((candidate) => known.has(candidate));
}

function bindingId(nodePath: NodePath, name: string): t.Node | undefined {
  return nodePath.scope.getBinding(name)?.identifier;
}

function stringValue(node: t.Node): string | undefined {
  if (t.isStringLiteral(node)) {
    return node.value;
  }
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return node.quasis[0].value.cooked ?? undefined;
  }
  return undefined;
}

function requireSource(node: t.Node | null | undefined): string | undefined {
  if (
    t.isCallExpression(node) &&
    t.isIdentifier(node.callee, { name: 'require' }) &&
    node.arguments.length === 1 &&
    t.isStringLiteral(node.arguments[0])
  ) {
    return node.arguments[0].value;
  }
  return undefined;
}

function unwrap(nodePath: NodePath): NodePath {
  let current = nodePath;
  while (
    current.isAwaitExpression() ||
    current.isTSAsExpression() ||
    current.isTSNonNullExpression() ||
    current.isTSSatisfiesExpression() ||
    current.isParenthesizedExpression()
  ) {
    current = current.get('expression') as NodePath;
  }
  return current;
}

function propertyName(member: t.MemberExpression | t.OptionalMemberExpression): string | undefined {
  if (!member.computed && t.isIdentifier(member.property)) {
    return member.property.name;
  }
  return stringValue(member.property);
}

class ApiUsageScanner {
  private readonly facts = new Map<string, FileFacts>();
  private readonly known: Set<string>;
  private readonly unparsed: string[] = [];

  constructor(files: SourceFile[]) {
    this.known = new Set(files.map((file) => file.path));
    for (const file of files) {
      const ast = this.parse(file);
      if (ast) {
        this.facts.set(file.path, this.collectFacts(file, ast));
      }
    }
  }

  scan(): ApiUsageScan {
    this.inferClients();
    return { usages: this.collectUsages(), unparsed: [...this.unparsed].sort() };
  }

  private parse(file: SourceFile): t.File | undefined {
    try {
      return parse(file.contents, PARSER_OPTIONS);
    } catch {
      this.unparsed.push(file.path);
      return undefined;
    }
  }

  /** Imports, exports, and SDK bindings: everything that does not depend on other files. */
  private collectFacts(file: SourceFile, ast: t.File): FileFacts {
    const { known } = this;
    const facts: FileFacts = {
      file,
      ast,
      sdkClasses: new Map(),
      sdkNamespaces: new Map(),
      axios: new Set(),
      clients: new Map(),
      factories: new Map(),
      thisClients: new Map(),
      links: [],
      namespaces: new Map(),
      exports: new Map(),
      starExports: [],
    };

    const bindModule = (id: t.Node, source: string, imported: string | '*' | 'default'): void => {
      const sdk = SDK_PACKAGES[source];

      if (sdk) {
        if (imported === '*') {
          facts.sdkNamespaces.set(id, sdk.provider);
        } else if (imported === 'default' || imported === sdk.clientClass) {
          facts.sdkClasses.set(id, sdk.provider);
        }
        return;
      }

      if (source === 'axios' && (imported === 'default' || imported === '*')) {
        facts.axios.add(id);
        return;
      }

      const target = resolveRelative(file.path, source, known);
      if (!target) {
        return;
      }

      if (imported === '*') {
        facts.namespaces.set(id, target);
      } else {
        facts.links.push({ id, file: target, name: imported });
      }
    };

    traverse(ast, {
      ImportDeclaration(nodePath) {
        const source = nodePath.node.source.value;
        for (const specifier of nodePath.node.specifiers) {
          const id = bindingId(nodePath, specifier.local.name);
          if (!id) {
            continue;
          }
          if (t.isImportNamespaceSpecifier(specifier)) {
            bindModule(id, source, '*');
          } else if (t.isImportDefaultSpecifier(specifier)) {
            bindModule(id, source, 'default');
          } else {
            const imported = t.isIdentifier(specifier.imported)
              ? specifier.imported.name
              : specifier.imported.value;
            bindModule(id, source, imported);
          }
        }
      },

      VariableDeclarator(nodePath) {
        const source = requireSource(nodePath.node.init);
        if (!source) {
          return;
        }

        const { id } = nodePath.node;
        if (t.isIdentifier(id)) {
          const binding = bindingId(nodePath, id.name);
          if (binding) {
            // `require` hands back the whole module, which is also its default.
            bindModule(binding, source, 'default');
            bindModule(binding, source, '*');
          }
          return;
        }

        if (t.isObjectPattern(id)) {
          for (const property of id.properties) {
            if (t.isObjectProperty(property) && t.isIdentifier(property.value)) {
              const binding = bindingId(nodePath, property.value.name);
              const imported = t.isIdentifier(property.key) ? property.key.name : stringValue(property.key);
              if (binding && imported) {
                bindModule(binding, source, imported);
              }
            }
          }
        }
      },

      ExportNamedDeclaration(nodePath) {
        const { node } = nodePath;
        const from = node.source ? resolveRelative(file.path, node.source.value, known) : undefined;

        if (node.declaration) {
          const declaration = node.declaration;
          const names = t.isVariableDeclaration(declaration)
            ? declaration.declarations.flatMap((d) => (t.isIdentifier(d.id) ? [d.id.name] : []))
            : 'id' in declaration && t.isIdentifier(declaration.id)
              ? [declaration.id.name]
              : [];
          for (const name of names) {
            facts.exports.set(name, { id: bindingId(nodePath, name) });
          }
          return;
        }

        for (const specifier of node.specifiers) {
          if (!t.isExportSpecifier(specifier)) {
            continue;
          }
          const exported = t.isIdentifier(specifier.exported) ? specifier.exported.name : specifier.exported.value;
          if (node.source) {
            if (from) {
              facts.exports.set(exported, { from: { file: from, name: specifier.local.name } });
            }
          } else {
            facts.exports.set(exported, { id: bindingId(nodePath, specifier.local.name) });
          }
        }
      },

      ExportAllDeclaration(nodePath) {
        const from = resolveRelative(file.path, nodePath.node.source.value, known);
        if (from) {
          facts.starExports.push(from);
        }
      },

      ExportDefaultDeclaration(nodePath) {
        const declaration = nodePath.get('declaration');
        if (declaration.isIdentifier()) {
          facts.exports.set('default', { id: bindingId(nodePath, declaration.node.name) });
        } else if (
          (declaration.isFunctionDeclaration() || declaration.isClassDeclaration()) &&
          declaration.node.id
        ) {
          facts.exports.set('default', { id: bindingId(declaration, declaration.node.id.name) });
        } else {
          facts.exports.set('default', { expr: declaration as NodePath });
        }
      },

      AssignmentExpression(nodePath) {
        const left = nodePath.node.left;
        if (!t.isMemberExpression(left)) {
          return;
        }

        const right = nodePath.get('right');
        const isModuleExports = (node: t.Node): boolean =>
          t.isMemberExpression(node) &&
          t.isIdentifier(node.object, { name: 'module' }) &&
          propertyName(node) === 'exports';

        // module.exports = value
        if (isModuleExports(left)) {
          facts.exports.set('default', { expr: right });
          if (right.isObjectExpression()) {
            for (const property of right.get('properties')) {
              if (property.isObjectProperty() && !property.node.computed && t.isIdentifier(property.node.key)) {
                facts.exports.set(property.node.key.name, { expr: property.get('value') as NodePath });
              }
            }
          }
          return;
        }

        // exports.name = value, module.exports.name = value
        const name = propertyName(left);
        if (name && (t.isIdentifier(left.object, { name: 'exports' }) || isModuleExports(left.object))) {
          facts.exports.set(name, { expr: right });
        }
      },
    });

    return facts;
  }

  /**
   * A client can be constructed in one file, wrapped by a factory in another,
   * and called in a third, so inference repeats over every file until nothing
   * new is learned.
   */
  private inferClients(): void {
    let changed = true;

    while (changed) {
      changed = false;

      for (const facts of this.facts.values()) {
        for (const link of facts.links) {
          const resolved = this.resolveExport(link.file, link.name, 0);
          if (resolved?.client && !facts.clients.has(link.id)) {
            facts.clients.set(link.id, resolved.client);
            changed = true;
          }
          if (resolved?.factory && !facts.factories.has(link.id)) {
            facts.factories.set(link.id, resolved.factory);
            changed = true;
          }
        }

        changed = this.inferLocal(facts) || changed;
      }
    }
  }

  private inferLocal(facts: FileFacts): boolean {
    let changed = false;
    const scanner = this;

    const learn = (map: Map<t.Node, ApiProvider>, id: t.Node | undefined, provider: ApiProvider | undefined): void => {
      if (id && provider && !map.has(id)) {
        map.set(id, provider);
        changed = true;
      }
    };

    traverse(facts.ast, {
      VariableDeclarator(nodePath) {
        if (!t.isIdentifier(nodePath.node.id) || !nodePath.node.init) {
          return;
        }
        const id = bindingId(nodePath, nodePath.node.id.name);
        const init = nodePath.get('init') as NodePath;
        learn(facts.clients, id, scanner.clientOf(facts, init, 0));
        learn(facts.factories, id, scanner.factoryOf(facts, init, 0));
      },

      FunctionDeclaration(nodePath) {
        if (nodePath.node.id) {
          learn(
            facts.factories,
            bindingId(nodePath, nodePath.node.id.name),
            scanner.returnedClient(facts, nodePath, 0),
          );
        }
      },

      AssignmentExpression(nodePath) {
        const { left } = nodePath.node;
        if (!t.isMemberExpression(left) || !t.isThisExpression(left.object)) {
          return;
        }
        const name = propertyName(left);
        const provider = scanner.clientOf(facts, nodePath.get('right'), 0);
        if (name && provider && !facts.thisClients.has(name)) {
          facts.thisClients.set(name, provider);
          changed = true;
        }
      },

      ClassProperty(nodePath) {
        const { key, value } = nodePath.node;
        if (!value || nodePath.node.computed || !t.isIdentifier(key)) {
          return;
        }
        const provider = scanner.clientOf(facts, nodePath.get('value') as NodePath, 0);
        if (provider && !facts.thisClients.has(key.name)) {
          facts.thisClients.set(key.name, provider);
          changed = true;
        }
      },
    });

    return changed;
  }

  private resolveExport(
    file: string,
    name: string,
    depth: number,
  ): { client?: ApiProvider; factory?: ApiProvider } | undefined {
    const facts = this.facts.get(file);
    if (!facts || depth > MAX_RESOLVE_DEPTH) {
      return undefined;
    }

    const entry = facts.exports.get(name);

    if (!entry) {
      for (const star of facts.starExports) {
        const resolved = this.resolveExport(star, name, depth + 1);
        if (resolved) {
          return resolved;
        }
      }
      return undefined;
    }

    if (entry.from) {
      return this.resolveExport(entry.from.file, entry.from.name, depth + 1);
    }

    if (entry.id) {
      return { client: facts.clients.get(entry.id), factory: facts.factories.get(entry.id) };
    }

    if (entry.expr) {
      return {
        client: this.clientOf(facts, entry.expr, depth + 1),
        factory: this.factoryOf(facts, entry.expr, depth + 1),
      };
    }

    return undefined;
  }

  /** The provider of the client an expression evaluates to, if it is one. */
  private clientOf(facts: FileFacts, expression: NodePath, depth: number): ApiProvider | undefined {
    if (depth > MAX_RESOLVE_DEPTH) {
      return undefined;
    }

    const nodePath = unwrap(expression);
    const { node } = nodePath;

    if (t.isNewExpression(node)) {
      if (t.isIdentifier(node.callee)) {
        const id = bindingId(nodePath, node.callee.name);
        return id ? facts.sdkClasses.get(id) : undefined;
      }
      // new sdk.OpenAI() after `import * as sdk from 'openai'`
      if (t.isMemberExpression(node.callee) && t.isIdentifier(node.callee.object)) {
        const id = bindingId(nodePath, node.callee.object.name);
        const provider = id ? facts.sdkNamespaces.get(id) : undefined;
        const name = propertyName(node.callee);
        const sdk = Object.values(SDK_PACKAGES).find((entry) => entry.provider === provider);
        return provider && (name === 'default' || name === sdk?.clientClass) ? provider : undefined;
      }
      return undefined;
    }

    if (t.isIdentifier(node)) {
      const id = bindingId(nodePath, node.name);
      return id ? facts.clients.get(id) : undefined;
    }

    if (t.isMemberExpression(node)) {
      const name = propertyName(node);
      if (!name) {
        return undefined;
      }
      if (t.isThisExpression(node.object)) {
        return facts.thisClients.get(name);
      }
      const target = this.namespaceOf(facts, nodePath.get('object') as NodePath);
      return target ? this.resolveExport(target, name, depth + 1)?.client : undefined;
    }

    if (t.isCallExpression(node)) {
      const callee = nodePath.get('callee') as NodePath;
      // client.withOptions({ ... }) returns a client with the same surface.
      if (callee.isMemberExpression() && propertyName(callee.node) === 'withOptions') {
        return this.clientOf(facts, callee.get('object') as NodePath, depth + 1);
      }
      return this.factoryOf(facts, callee, depth + 1);
    }

    return undefined;
  }

  /** The provider of the client a function returns, if the expression is such a function. */
  private factoryOf(facts: FileFacts, expression: NodePath, depth: number): ApiProvider | undefined {
    if (depth > MAX_RESOLVE_DEPTH) {
      return undefined;
    }

    const nodePath = unwrap(expression);
    const { node } = nodePath;

    if (nodePath.isArrowFunctionExpression() || nodePath.isFunctionExpression()) {
      return this.returnedClient(facts, nodePath, depth + 1);
    }

    if (t.isIdentifier(node)) {
      const id = bindingId(nodePath, node.name);
      return id ? facts.factories.get(id) : undefined;
    }

    if (t.isMemberExpression(node)) {
      const name = propertyName(node);
      const target = this.namespaceOf(facts, nodePath.get('object') as NodePath);
      return name && target ? this.resolveExport(target, name, depth + 1)?.factory : undefined;
    }

    return undefined;
  }

  private returnedClient(
    facts: FileFacts,
    fn: NodePath<t.Function>,
    depth: number,
  ): ApiProvider | undefined {
    const body = fn.get('body') as NodePath;

    if (!body.isBlockStatement()) {
      return this.clientOf(facts, body, depth + 1);
    }

    let provider: ApiProvider | undefined;
    const scanner = this;

    body.traverse({
      Function(inner) {
        inner.skip();
      },
      ReturnStatement(statement) {
        const argument = statement.get('argument');
        if (!provider && argument.node) {
          provider = scanner.clientOf(facts, argument as NodePath, depth + 1);
        }
      },
    });

    return provider;
  }

  private namespaceOf(facts: FileFacts, expression: NodePath): string | undefined {
    if (!expression.isIdentifier()) {
      return undefined;
    }
    const id = bindingId(expression, expression.node.name);
    return id ? facts.namespaces.get(id) : undefined;
  }

  private collectUsages(): ApiUsage[] {
    const usages: ApiUsage[] = [];
    const scanner = this;

    for (const facts of this.facts.values()) {
      traverse(facts.ast, {
        CallExpression(nodePath) {
          const usage = scanner.sdkCall(facts, nodePath) ?? scanner.httpCall(facts, nodePath);
          if (usage) {
            usages.push(usage);
          }
        },
      });
    }

    return usages.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  }

  private sdkCall(facts: FileFacts, call: NodePath<t.CallExpression>): ApiUsage | undefined {
    const names: string[] = [];
    let current = call.get('callee') as NodePath;
    let provider: ApiProvider | undefined;

    // Walk down the chain until the object is a client: `this.client` or
    // `module.client` are clients themselves, and so is a call such as
    // client.withOptions({ ... }) in client.withOptions({ ... }).messages.create().
    while (!provider && current.isMemberExpression()) {
      const name = propertyName(current.node);
      if (!name) {
        return undefined;
      }
      names.unshift(name);
      current = current.get('object') as NodePath;
      provider = this.clientOf(facts, current, 0);
    }

    if (!provider || (names.length === 1 && names[0] === 'withOptions')) {
      return undefined;
    }

    const method = names.join('.');
    return {
      provider,
      file: facts.file.path,
      line: call.node.loc?.start.line ?? 0,
      style: 'sdk',
      method,
      operation: lookupOperation(provider, method),
      ...requestShape(call.get('arguments')[0]),
    };
  }

  private httpCall(facts: FileFacts, call: NodePath<t.CallExpression>): ApiUsage | undefined {
    const callee = call.get('callee');
    const args = call.get('arguments');
    let urlPath: NodePath | undefined;
    let method: string | undefined;
    let body: NodePath | undefined;

    if (callee.isIdentifier({ name: 'fetch' }) && !call.scope.getBinding('fetch')) {
      urlPath = args[0];
      const options = args[1];
      if (options?.isObjectExpression()) {
        method = staticString(objectProperty(options, 'method'))?.toUpperCase();
        body = jsonStringifyArgument(objectProperty(options, 'body'));
      }
      method ??= 'GET';
    } else if (this.isAxios(facts, callee)) {
      const config = args[0];
      if (config?.isObjectExpression()) {
        urlPath = objectProperty(config, 'url');
        method = staticString(objectProperty(config, 'method'))?.toUpperCase() ?? 'GET';
        body = objectProperty(config, 'data');
      }
    } else if (callee.isMemberExpression() && this.isAxios(facts, callee.get('object') as NodePath)) {
      const name = propertyName(callee.node);
      if (!name || !AXIOS_METHODS.has(name)) {
        return undefined;
      }
      if (name === 'request') {
        const config = args[0];
        if (config?.isObjectExpression()) {
          urlPath = objectProperty(config, 'url');
          method = staticString(objectProperty(config, 'method'))?.toUpperCase() ?? 'GET';
          body = objectProperty(config, 'data');
        }
      } else {
        urlPath = args[0];
        method = name.toUpperCase();
        body = ['post', 'put', 'patch'].includes(name) ? args[1] : undefined;
      }
    } else {
      return undefined;
    }

    const url = urlPath ? staticString(urlPath, true) : undefined;
    if (!url) {
      return undefined;
    }

    const match = /^(?:https?:)?\/\/([^/?#]+)(\/[^?#]*)?/.exec(url);
    const provider = match ? API_HOSTS[match[1]] : undefined;
    if (!provider) {
      return undefined;
    }

    const shape = body ? requestShape(body) : { params: [], modelIds: [], dynamic: false };
    return {
      provider,
      file: facts.file.path,
      line: call.node.loc?.start.line ?? 0,
      style: 'http',
      operation: `${method} ${match?.[2] ?? '/'}`,
      ...shape,
    };
  }

  private isAxios(facts: FileFacts, expression: NodePath): boolean {
    if (!expression.isIdentifier()) {
      return false;
    }
    const id = bindingId(expression, expression.node.name);
    return id !== undefined && facts.axios.has(id);
  }
}

function objectProperty(object: NodePath<t.ObjectExpression>, key: string): NodePath | undefined {
  for (const property of object.get('properties')) {
    if (
      property.isObjectProperty() &&
      !property.node.computed &&
      (t.isIdentifier(property.node.key, { name: key }) || t.isStringLiteral(property.node.key, { value: key }))
    ) {
      return property.get('value') as NodePath;
    }
  }
  return undefined;
}

function jsonStringifyArgument(value: NodePath | undefined): NodePath | undefined {
  if (
    value?.isCallExpression() &&
    t.isMemberExpression(value.node.callee) &&
    t.isIdentifier(value.node.callee.object, { name: 'JSON' }) &&
    propertyName(value.node.callee) === 'stringify'
  ) {
    return value.get('arguments')[0];
  }
  return value;
}

/**
 * A string the code spells out, following `const` bindings. With
 * `placeholders`, unknown parts of a template become `{param}`, which keeps
 * the host and the path readable in `${base}/v1/files/${id}`.
 */
function staticString(value: NodePath | undefined, placeholders = false, depth = 0): string | undefined {
  if (!value || depth > MAX_RESOLVE_DEPTH) {
    return undefined;
  }

  const nodePath = unwrap(value);
  const { node } = nodePath;

  if (t.isStringLiteral(node)) {
    return node.value;
  }

  if (t.isTemplateLiteral(node)) {
    const expressions = nodePath.get('expressions') as NodePath[];
    let result = '';
    for (const [index, quasi] of node.quasis.entries()) {
      result += quasi.value.cooked ?? '';
      if (index < expressions.length) {
        const part = staticString(expressions[index], placeholders, depth + 1);
        if (part === undefined && !placeholders) {
          return undefined;
        }
        result += part ?? '{param}';
      }
    }
    return result;
  }

  if (t.isBinaryExpression(node, { operator: '+' })) {
    const left = staticString(nodePath.get('left') as NodePath, placeholders, depth + 1);
    const right = staticString(nodePath.get('right') as NodePath, placeholders, depth + 1);
    if (left === undefined || right === undefined) {
      return placeholders && (left !== undefined || right !== undefined)
        ? `${left ?? '{param}'}${right ?? '{param}'}`
        : undefined;
    }
    return left + right;
  }

  if (t.isIdentifier(node)) {
    const binding = nodePath.scope.getBinding(node.name);
    if (binding?.constant && binding.path.isVariableDeclarator() && binding.path.node.init) {
      return staticString(binding.path.get('init') as NodePath, placeholders, depth + 1);
    }
  }

  return undefined;
}

/** What the code tells us about a request object without running it. */
function requestShape(argument: NodePath | undefined): Pick<ApiUsage, 'params' | 'modelIds' | 'dynamic'> {
  if (!argument) {
    return { params: [], modelIds: [], dynamic: false };
  }

  let object = unwrap(argument);

  // A request built once as a constant and passed by name.
  if (object.isIdentifier()) {
    const binding = object.scope.getBinding(object.node.name);
    if (binding?.constant && binding.path.isVariableDeclarator() && binding.path.node.init) {
      object = unwrap(binding.path.get('init') as NodePath);
    }
  }

  if (!object.isObjectExpression()) {
    return { params: [], modelIds: [], dynamic: true };
  }

  const params = new Set<string>();
  const modelIds = new Set<string>();
  let dynamic = false;

  for (const property of object.get('properties')) {
    if (property.isSpreadElement() || (!property.isObjectProperty() && !property.isObjectMethod())) {
      dynamic = true;
      continue;
    }

    const { key, computed } = property.node;
    const name = computed ? undefined : t.isIdentifier(key) ? key.name : stringValue(key);
    if (!name) {
      dynamic = true;
      continue;
    }
    params.add(name);

    if (name === 'model' && property.isObjectProperty()) {
      const model = staticString(property.get('value') as NodePath);
      if (model === undefined) {
        dynamic = true;
      } else {
        modelIds.add(model);
      }
    }
  }

  return { params: [...params].sort(), modelIds: [...modelIds].sort(), dynamic };
}

/**
 * Finds every call a repository makes to the Anthropic or OpenAI API, through
 * the official SDKs or raw HTTP. Only code is read: a provider named in a
 * string or a comment is not a call, and nothing from the repository runs.
 */
export function scanApiUsage(files: SourceFile[]): ApiUsageScan {
  return new ApiUsageScanner(files).scan();
}
