const hasScriptsChange = (files) => files.some((f) => /(^|\/)scripts\//.test(f));

const hasMcpSrcChange = (files) => files.some((f) => /(^|\/)mcp-server\/src\//.test(f));

// Re-serialize workflow JSON with JSON.stringify(…, null, 2) so that
// every array/object is fully expanded.  Prettier alone won't do this
// because it keeps short arrays inline when they fit within printWidth.
const expandJson =
  'node -e \'const fs=require("fs"),f=process.argv[1],d=JSON.parse(fs.readFileSync(f,"utf8"));fs.writeFileSync(f,JSON.stringify(d,null,2)+"\\n")\'';

export default (stagedFiles) => {
  const tasks = [];

  const mdFiles = stagedFiles.filter((f) => f.endsWith('.md'));
  if (mdFiles.length) {
    tasks.push(`markdownlint --fix ${mdFiles.map((f) => `"${f}"`).join(' ')}`);
    tasks.push(`prettier --write ${mdFiles.map((f) => `"${f}"`).join(' ')}`);
  }

  const jsTsFiles = stagedFiles.filter((f) => /\.(js|ts)$/.test(f));
  if (jsTsFiles.length) {
    tasks.push(`eslint --fix ${jsTsFiles.map((f) => `"${f}"`).join(' ')}`);
  }

  // Expand workflow JSONs before prettier so inline arrays get normalised.
  const workflowFiles = stagedFiles.filter((f) => /(^|\/)workflows\/.*\.json$/.test(f));
  for (const wf of workflowFiles) {
    tasks.push(`${expandJson} "${wf}"`);
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
