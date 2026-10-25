import ts from 'typescript';
/** Validates transfer format only. Execution remains in the isolated browser sandbox. */
export function validateCandidateSource(value: unknown): asserts value is string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 65536 || !value.trim())
    throw new Error('source must be nonempty JavaScript of at most 64 KiB');
  const file = ts.createSourceFile(
    'candidate.js',
    value,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  let exported = false;
  const walk = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier) ||
      (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) ||
      ts.isMetaProperty(node)
    )
      throw new Error('imports and external module access are forbidden');
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === 'decide' &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      !node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) &&
      !!node.body
    )
      exported = true;
    ts.forEachChild(node, walk);
  };
  walk(file);
  if (!exported) throw new Error('source must declare export function decide(observation, state)');
  const result = ts.transpileModule(value, {
    fileName: 'candidate.js',
    reportDiagnostics: true,
    compilerOptions: {
      allowJs: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  if (result.diagnostics?.some((d) => d.category === ts.DiagnosticCategory.Error))
    throw new Error('source contains invalid JavaScript syntax');
}
