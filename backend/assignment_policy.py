"""Protection is independent of assignment provenance; legacy entries stay fixed."""

def is_protected_assignment(assignment):
    return assignment.source != "solver" or assignment.locked
