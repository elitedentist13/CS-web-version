"""
CS caries subsystem — a bitewing-targeted caries screening aid.

Design ("our own", referencing Pearl's methodology, not cloning it):

    trained model  →  recall (find candidate lesions)
    reasoning layer → precision (screen out the errors)

A fine-tuned instance-segmentation model (YOLOv8-seg on bitewings, see
caries/train/) proposes candidate lesions. The reasoning layer then applies
four independent "skills", each able to VETO a candidate outright:

    1. anatomical correction — is the candidate on a caries-prone tooth
       surface, or is it sitting on the pulp/canal, off the tooth, or below
       the apex?
    2. contrast assessment   — is it genuinely radiolucent relative to the
       SAME tooth's sound tissue, with a caries-like (non-razor) margin?
    3. pathology relay        — is it actually a known confounder: a
       restoration, cervical burnout, the pulp chamber, or a Mach band?
    4. calibration            — turn the surviving evidence into a confidence
       the UI slider can interpret, capped because this is a screening aid,
       not a cleared diagnosis.

The layer is deliberately model-agnostic: it runs the same way over a trained
model's output or over a classical candidate generator, so it keeps working
(with lower recall, stated honestly) before any weights are trained.
"""

from .detect import detect_caries  # noqa: F401
