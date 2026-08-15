const path = require('node:path');
const Database = require('better-sqlite3');
const {
    createDatabaseBackup,
    defaultBackupRoot,
    listBackups,
    verifyBackupArtifact,
} = require('../api/services/databaseBackup.cjs');
const {
    RESTORE_CONFIRMATION,
    restoreDatabaseBackup,
} = require('../api/services/databaseRestore.cjs');

function parseArguments(argv) {
    const [command = 'list', ...rest] = argv;
    const options = {};
    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index];
        if (!token.startsWith('--')) throw new Error(`无法识别的参数: ${token}`);
        const key = token.slice(2);
        const next = rest[index + 1];
        if (!next || next.startsWith('--')) {
            options[key] = true;
            continue;
        }
        options[key] = next;
        index += 1;
    }
    return { command, options };
}

function resolveProjectPath(value) {
    return path.resolve(process.cwd(), value);
}

function optionValue(options, key) {
    const value = options[key];
    if (value === undefined) return undefined;
    if (value === true || !String(value).trim()) {
        throw new Error(`--${key} 必须提供值`);
    }
    return String(value).trim();
}

function selectedBackup(options, root) {
    if (options.file) return resolveProjectPath(optionValue(options, 'file'));
    if (options.latest) {
        const latest = listBackups(root, { type: options.type })[0];
        if (!latest) throw new Error('没有找到可验证的备份');
        return latest.path;
    }
    throw new Error('必须提供 --file <备份路径> 或 --latest');
}

async function create(options, root) {
    const gitCommit = optionValue(options, 'git-commit');
    const mirrorRoot = optionValue(options, 'mirror-dir');
    const sourcePath = resolveProjectPath(options.source || 'pump.db');
    const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
    try {
        const result = await createDatabaseBackup(db, {
            type: options.type || 'release',
            root,
            sourcePath,
            gitCommit,
            mirrorRoot,
        });
        return {
            success: true,
            command: 'create',
            backup: result.path,
            metadata: result.metadataPath,
            mirror: result.mirrorPath,
            removed: result.removed,
            gitCommit: result.metadata.gitCommit,
            schemaVersion: result.metadata.schema.migrationVersion,
            sha256: result.metadata.sha256,
        };
    } finally {
        db.close();
    }
}

function list(options, root) {
    return {
        success: true,
        command: 'list',
        root,
        backups: listBackups(root, { type: options.type }),
    };
}

function verify(options, root) {
    const backupPath = selectedBackup(options, root);
    const result = verifyBackupArtifact(backupPath, {
        expectedGitCommit: optionValue(options, 'expect-commit'),
    });
    return {
        success: true,
        command: 'verify',
        backup: result.path,
        bytes: result.bytes,
        sha256: result.sha256,
        schema: result.schema,
        tableCounts: result.tableCounts,
        gitCommit: result.metadata?.gitCommit || '',
    };
}

async function restore(options, root) {
    const backupPath = selectedBackup(options, root);
    const result = await restoreDatabaseBackup({
        root,
        backupPath,
        targetPath: resolveProjectPath(options.target || 'pump.db'),
        confirmation: optionValue(options, 'confirm'),
        expectedGitCommit: optionValue(options, 'expect-commit'),
        currentGitCommit: optionValue(options, 'current-commit'),
        port: optionValue(options, 'port'),
        skipPortCheck: options['skip-port-check'] === true,
    });
    return {
        success: true,
        command: 'restore',
        restored: result.restored.path,
        schema: result.restored.schema,
        source: result.source.path,
        sourceGitCommit: result.source.metadata?.gitCommit || '',
        safetyBackup: result.safetyBackup,
        movedSidecars: result.movedSidecars,
    };
}

async function main() {
    const { command, options } = parseArguments(process.argv.slice(2));
    const root = options.root
        ? resolveProjectPath(options.root)
        : defaultBackupRoot();
    let result;
    if (command === 'create') result = await create(options, root);
    else if (command === 'list') result = list(options, root);
    else if (command === 'verify') result = verify(options, root);
    else if (command === 'restore') result = await restore(options, root);
    else {
        throw new Error(
            '用法: create|list|verify|restore；恢复必须提供 '
            + `--confirm ${RESTORE_CONFIRMATION}`
        );
    }
    console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
