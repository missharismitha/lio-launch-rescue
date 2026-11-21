"""Evidence-mode conversational answers; never impersonates a model response."""
import re


def answer(question, issue, case, overview):
    text = question.casefold()
    gap = issue.get('shortage', 0)
    if re.search(r'\b(source|sources|evidence|document|documents|proof)\b', text):
        sources = '\n\n'.join(f"{i+1}. {s['label']}\n{s.get('excerpt', '')[:700]}" for i,s in enumerate(issue.get('evidence', [])))
        return 'This finding comes from these linked customer records:\n\n' + (sources or 'No source documents are linked; verify the finding before acting.') + '\n\nOpen Evidence in the inspector to read the originals.'
    if re.search(r'\b(email|send|supplier|approve|approval|inquiry)\b', text):
        return ('The inquiry is ' + case.get('state', 'not started').replace('_', ' ') + '. '
                'Review & activity shows the recipient, exact message and named approval control. '
                'Sending requires a configured registered sender and a verified supplier recipient. '
                'I have not sent an email in response to this message. An inquiry is not an order or a confirmed shipment.')
    if re.search(r'\b(recovery|recover|fix|plan|options|cost|price|next)\b', text):
        actions = '\n'.join(f"• {a['title']}: {a['description']}" for a in issue.get('actions', []))
        offer = case.get('recovery_offer')
        reviewed = (f"\n\nReviewed offer: {offer['offer_quantity']:,} units; warehouse arrival {offer['arrival_at']}; total €{offer['cost_eur']:,.2f}. "
                    'This is a scenario, not stock or an order.') if offer else ''
        return (issue.get('recovery', {}).get('description', 'No feasible recovery has been established.') + '\n\n' + actions + reviewed +
                '\n\nThe Recovery tab contains the assumptions. Supplier availability, warehouse delivery and time to pack need verification.')
    if re.search(r'\b(deadline|launch|time|hours|packing|pack)\b', text):
        lines = '\n'.join(f"• {p['name']}: {p['remaining']:,} still to pack at the recorded rate of {p.get('rate_per_hour',0):,.0f}/hour." for p in overview.get('products', []))
        return (f"The source launch date is {overview.get('launch_date') or 'not available'}.\n\n{lines}\n\n"
                'These are snapshot assumptions. Confirm current progress and remaining shifts. Arrival at a port or airport is not warehouse receipt. '
                'Reviewed supplier offers have per-edition packing bounds; they share the same offered units and cannot be added together.')
    if re.search(r'\b(risk|short|shortage|gap|why|stock|many|quantity|quantities)\b', text):
        return (f"{issue.get('summary', '')}\n\nThe current reconciliation is:\n"
                f"• Required: {issue.get('required',0):,}\n• Usable stock estimate: {issue.get('usable_stock',0):,}\n"
                f"• Expected incoming: {issue.get('incoming',0):,}\n• Uncovered: {gap:,}\n\n"
                'These figures come from the source snapshot, not a physical count. Different component gaps can affect the same copies.')
    return (f"I can help you inspect {issue.get('material_name', issue['material_id'])}. "
            f"The current case has an uncovered quantity of {gap:,}.\n\n"
            'Ask me to explain the risk, show the evidence, compare recovery options, or explain the inquiry approval. '
            'These answers use the case records. Open-ended model investigation becomes available when a model is configured.')
