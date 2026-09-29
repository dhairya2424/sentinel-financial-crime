import { describe, expect, it } from 'vitest'
import { ImportFileError, parseCsv, parseImport } from '../importFile'

describe('parseCsv', () => {
  it('handles quoted commas, doubled quotes, CRLF and blank lines', () => {
    const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""",3\r\n\r\n1,2,"multi\nline"\n')
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', '3'],
      ['1', '2', 'multi\nline'],
    ])
  })

  it('refuses a file that ends inside a quote', () => {
    expect(() => parseCsv('a,b\n"open,1\n')).toThrow(ImportFileError)
  })
})

describe('parseImport', () => {
  it('reads a CSV export, parses JSON columns and generates missing ids', () => {
    const csv = [
      '﻿kind,from_account_id,to_account_id,amount,channel,value_ts,raw',
      'transaction,acct_1,acct_2,240000.00,neft,2026-09-28T10:30:00+05:30,"{""narration"":""RTGS LOOP""}"',
      'transaction,acct_2,,5000,upi,2026-09-28T11:00:00+05:30,',
    ].join('\n')
    const rows = parseImport('export.csv', csv)
    expect(rows.map((r) => r.error)).toEqual([null, null])
    const [first, second] = rows
    expect(first?.event).toMatchObject({ kind: 'transaction', amount: '240000.00', raw: { narration: 'RTGS LOOP' } })
    expect(first?.event?.id).toMatch(/^tx_ui_[0-9a-f]{32}$/)
    expect(second?.event).not.toHaveProperty('to_account_id')
    expect(second?.summary).toBe('Transaction ₹5,000 acct_2 → another bank')
  })

  it('flags rows that cannot be sent, with the reason', () => {
    const rows = parseImport(
      'mixed.json',
      JSON.stringify({
        events: [
          { kind: 'session', employee_id: 'emp_1', started_at: '2026-09-28T09:00:00Z', id: 'sess_keep' },
          { kind: 'transaction', amount: '10', value_ts: '2026-09-28T09:00:00Z' },
          { kind: 'payment', amount: '10' },
          { kind: 'access_right', employee_id: 'emp_1', entitlement: 'tx.approve', granted_at: '2026-09-28T09:00:00Z', colour: 'red' },
          'not a record',
        ],
      }),
    )
    expect(rows.map((r) => r.error)).toEqual([
      null,
      'missing from_account_id or to_account_id',
      'kind must be one of transaction, employee_action, session, access_right',
      'unknown column colour',
      'this row is not a record',
    ])
    expect(rows[0]?.event?.id).toBe('sess_keep')
  })

  it('explains a file it cannot use at all', () => {
    expect(() => parseImport('a.csv', 'amount,value_ts\n1,2')).toThrow('kind column')
    expect(() => parseImport('a.json', '{"rows": []}')).toThrow('events list')
    expect(() => parseImport('a.csv', 'kind,amount\n')).toThrow('no records')
  })
})
