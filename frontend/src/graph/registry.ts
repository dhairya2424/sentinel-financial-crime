import { BundleEdge } from './BundleEdge'
import { AccountNode, CustomerNode, EmployeeNode, TransactionNode } from './nodes'

export const NODE_TYPES = {
  customer: CustomerNode,
  account: AccountNode,
  employee: EmployeeNode,
  transaction: TransactionNode,
}

export const EDGE_COMPONENTS = { bundle: BundleEdge }
