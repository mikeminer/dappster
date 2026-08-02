export const DAPPSTER_DEPLOYMENT_FEE = "0.001"
export const DAPPSTER_FEE_RECIPIENT = "0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134"
export const DAPPSTER_FEE_EVENT_NAME = "DappsterDeploymentFeePaid"

export const DAPPSTER_FEE_EVENT_ABI = [{
  type: "event",
  name: DAPPSTER_FEE_EVENT_NAME,
  inputs: [
    { name: "recipient", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ],
}] as const

function sourceWithoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

export function hasRequiredDeploymentFee(source: string) {
  const code = sourceWithoutComments(source)
  const compact = code.replace(/\s+/g, " ")
  return compact.toLowerCase().includes(DAPPSTER_FEE_RECIPIENT.toLowerCase())
    && /DAPPSTER_DEPLOY_FEE\s*=\s*0\.001\s+ether\s*;/.test(compact)
    && /constructor\s*\([^)]*\)[^{;]*\bpayable\b[^{;]*\{/.test(compact)
    && /msg\.value\s*!=\s*DAPPSTER_DEPLOY_FEE/.test(compact)
    && /\.call\s*\{\s*value\s*:\s*DAPPSTER_DEPLOY_FEE\s*\}\s*\(\s*""\s*\)/.test(compact)
    && /emit\s+DappsterDeploymentFeePaid\s*\(\s*DAPPSTER_FEE_RECIPIENT\s*,\s*DAPPSTER_DEPLOY_FEE\s*\)/.test(compact)
}

export function assertRequiredDeploymentFee(source: string) {
  if (!hasRequiredDeploymentFee(source)) {
    throw new Error("This contract is missing the mandatory 0.001 native-token Dappster deployment fee. Generate it again before deploying.")
  }
}

export const DAPPSTER_FEE_SOLIDITY_REQUIREMENTS = `The generated Solidity MUST implement the Dappster deployment fee in the deployment transaction itself. Include these exact declarations in the main contract:
address payable private constant DAPPSTER_FEE_RECIPIENT = payable(0x5D69C42A3a481d0CCFd88CFA8a2a08e2BF456134);
uint256 private constant DAPPSTER_DEPLOY_FEE = 0.001 ether;
event DappsterDeploymentFeePaid(address indexed recipient, uint256 amount);
error InvalidDappsterDeploymentFee();
error DappsterDeploymentFeeTransferFailed();
The zero-argument constructor MUST be payable and MUST execute:
if (msg.value != DAPPSTER_DEPLOY_FEE) revert InvalidDappsterDeploymentFee();
(bool feePaid, ) = DAPPSTER_FEE_RECIPIENT.call{value: DAPPSTER_DEPLOY_FEE}("");
if (!feePaid) revert DappsterDeploymentFeeTransferFailed();
emit DappsterDeploymentFeePaid(DAPPSTER_FEE_RECIPIENT, DAPPSTER_DEPLOY_FEE);
Keep the constructor zero-argument, use msg.sender for ownership/roles, and state in deployInstructions that deployment sends 0.001 of the selected chain's native token (for example ETH, HYPE on HyperEVM, or POL on Polygon) plus network gas.`
