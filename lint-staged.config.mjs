const hasScriptsChange = (files) => files.some((f) => /(^|\/)scripts\//.test(f));

const hasMcpSrcChange = (files) => files.some((f) => /(^|\/)mcp-server\/src\//.test(f));

export default (stagedFiles) => {
  const tasks = [];

  const mdFiles = stagedFiles.filter((f) => f.endsWith('.md'));
  if (mdFiles.length) {
    tasks.push(`markdownlint --fix ${mdFiles.map((f) => `"${f}"`).join(' ')}`);
    tasks.push(`prettier --write ${mdFiles.map((f) => `"${f}"`).join(' ')}`);
  }

  const fmtFiles = stagedFiles.filter((f) => /\.(js|ts|json|yml|yaml)$/.test(f));
  if (fmtFiles.length) {
    tasks.push(`prettier --write ${fmtFiles.map((f) => `"${f}"`).join(' ')}`);
  }

  if (hasScriptsChange(stagedFiles)) {
    tasks.push('npm run test:scripts');
  }

  if (hasMcpSrcChange(stagedFiles)) {
    tasks.push('npm run test:mcp');
  }

  return tasks;
};
