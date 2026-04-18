import { Box, TextField } from '@mui/material';

export interface OrderBasicInfoProps {
  customerName: string;
  setCustomerName: (v: string) => void;
  contractNo: string;
  setContractNo: (v: string) => void;
  remark: string;
  setRemark: (v: string) => void;
}

export default function OrderBasicInfo(props: OrderBasicInfoProps) {
  const { customerName, setCustomerName, contractNo, setContractNo, remark, setRemark } = props;
  
  return (
    <Box sx={{ maxWidth: 480 }}>
      <TextField
        label="客户名称"
        value={customerName}
        onChange={(e) => setCustomerName(e.target.value)}
        fullWidth
        required
        sx={{ mb: 2 }}
        placeholder="如：张工、华东水务公司"
      />
      <TextField
        label="合同号"
        value={contractNo}
        onChange={(e) => setContractNo(e.target.value)}
        fullWidth
        sx={{ mb: 2 }}
        placeholder="如：HT-2026-001"
      />
      <TextField
        label="备注（可选）"
        value={remark}
        onChange={(e) => setRemark(e.target.value)}
        fullWidth
        multiline
        rows={2}
        placeholder="交货日期、特殊要求等"
      />
    </Box>
  );
}
