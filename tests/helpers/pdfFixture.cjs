function escapePdfText(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');
}

function buildPdfBuffer(pages = []) {
    const normalizedPages = pages.length > 0 ? pages : [[]];
    const fontRef = 3 + normalizedPages.length * 2;
    const pageRefs = normalizedPages.map((_page, index) => 3 + index * 2);
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        `<< /Type /Pages /Kids [${pageRefs.map(ref => `${ref} 0 R`).join(' ')}] /Count ${normalizedPages.length} >>`,
    ];

    normalizedPages.forEach((items, index) => {
        const pageRef = 3 + index * 2;
        const contentRef = pageRef + 1;
        const content = (items || []).map(item => (
            `BT /F1 ${Number(item.size || 12)} Tf 1 0 0 1 ${Number(item.x || 72)} ${Number(item.y || 720)} Tm (${escapePdfText(item.text)}) Tj ET`
        )).join('\n') || 'q Q';
        objects.push(
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontRef} 0 R >> >> /Contents ${contentRef} 0 R >>`,
            `<< /Length ${Buffer.byteLength(content, 'binary')} >>\nstream\n${content}\nendstream`
        );
    });
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(pdf, 'binary'));
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = Buffer.byteLength(pdf, 'binary');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index <= objects.length; index += 1) {
        pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(pdf, 'binary');
}

module.exports = {
    buildPdfBuffer,
};
