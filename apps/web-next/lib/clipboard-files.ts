export const MAX_PASTED_FILE_SIZE = 10 * 1024 * 1024;

export const FACTORY_ATTACHMENT_EXTENSIONS = [
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt', '.md',
  '.png', '.jpg', '.jpeg', '.webp',
] as const;

export const RECIPE_TEST_REPORT_EXTENSIONS = ['.xls', '.xlsx'] as const;

type ClipboardFileDecision =
  | { kind: 'empty' }
  | { kind: 'rejected'; message: string }
  | { kind: 'accepted'; file: File; notice: string };

type ClipboardFilePolicy = {
  allowedExtensions: readonly string[];
  allowedLabel: string;
  maxBytes?: number;
};

function fileExtension(fileName: string) {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

export function selectClipboardFile(
  files: FileList,
  policy: ClipboardFilePolicy,
): ClipboardFileDecision {
  if (files.length === 0) return { kind: 'empty' };

  const file = files[0];
  const extension = fileExtension(file.name);
  if (!policy.allowedExtensions.includes(extension)) {
    return {
      kind: 'rejected',
      message: `不支持粘贴“${file.name}”，请选择${policy.allowedLabel}。`,
    };
  }

  const maxBytes = policy.maxBytes ?? MAX_PASTED_FILE_SIZE;
  if (file.size > maxBytes) {
    return {
      kind: 'rejected',
      message: `“${file.name}”超过 10MB，无法上传。`,
    };
  }

  return {
    kind: 'accepted',
    file,
    notice: files.length > 1
      ? `检测到 ${files.length} 个文件，本次仅上传第一个“${file.name}”。`
      : '',
  };
}
