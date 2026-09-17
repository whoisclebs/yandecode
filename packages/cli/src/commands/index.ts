// Each command module registers itself via registerCommand() on import.
// Later tasks add one `import './<command>.js';` line here.
import './init.js';
import './uninstall.js';
import './doctor.js';
import './status.js';
import './hook.js';
import './mcp.js';
import './rag.js';
import './index-cmd.js';
export {};
